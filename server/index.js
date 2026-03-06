const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const db = require('./database');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3001;

// 🔒 Audit Finding 12: Restricted CORS (Internal/Local only for v1)
app.use(cors({
    origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:12450',
        'http://127.0.0.1:12450'
    ]
}));
app.use(express.json());

// 🩺 Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date() });
});

// 🛡️ SSRF Protection Helper
function validateUrl(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        const hostname = parsed.hostname.toLowerCase();
        // Block localhost and private IP ranges
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false;
        if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) return false;
        return true;
    } catch (e) {
        return false;
    }
}

// 🌐 Secure Proxy with Script Injection
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || !validateUrl(targetUrl)) {
        return res.status(400).send('Invalid or Restricted URL');
    }

    try {
        console.log(`🌐 Secure Proxying: ${targetUrl}`);
        const response = await axios.get(targetUrl, {
            timeout: 10000,
            maxContentLength: 5 * 1024 * 1024, // 5MB limit
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        const $ = cheerio.load(response.data);
        const pickerScript = fs.readFileSync(path.join(__dirname, '..', 'shared', 'picker.js'), 'utf8');
        $('head').append(`<script>${pickerScript}</script>`);
        $('meta[http-equiv="Content-Security-Policy"]').remove();
        
        // Rewrite links to be absolute so they work in iframe
        $('a, img, link, script').each((i, el) => {
            const attr = el.name === 'a' || el.name === 'link' ? 'href' : 'src';
            const val = $(el).attr(attr);
            if (val && !val.startsWith('http') && !val.startsWith('#') && !val.startsWith('data:')) {
                try { $(el).attr(attr, new URL(val, targetUrl).href); } catch(e) {}
            }
        });

        res.send($.html());
    } catch (error) {
        res.status(500).send(`Proxy Error: ${error.message}`);
    }
});

// 📑 Recipe Management
app.post('/api/recipes', async (req, res) => {
    try {
        const recipe = await db.saveRecipe(req.body);
        res.json(recipe);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/recipes', async (req, res) => {
    try {
        const recipes = await db.getRecipes();
        res.json(recipes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🚀 Scraper with Guardrails & Fixed Scoping
app.post('/api/scrape', async (req, res) => {
    let { url, selectors, maxPages = 3, deepScrape = false, detailSelectors = {} } = req.body;
    
    // 🛡️ Audit Finding 10: Validation & Guardrails
    if (!url || !validateUrl(url)) return res.status(400).json({ error: 'Invalid URL' });
    if (!selectors || !selectors.productCard) return res.status(400).json({ error: 'Missing product card selector' });
    maxPages = Math.max(1, Math.min(parseInt(maxPages), 20));

    console.log(`🚀 Scrape Job: ${url} (Max Pages: ${maxPages}, Deep: ${deepScrape})`);
    let browser;
    let allResults = [];
    
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
        
        let currentPageUrl = url;
        let pagesProcessed = 0;
        const visitedUrls = new Set();

        while (pagesProcessed < maxPages && !visitedUrls.has(currentPageUrl)) {
            visitedUrls.add(currentPageUrl);
            console.log(`📄 Processing Page ${pagesProcessed + 1}...`);
            
            await page.goto(currentPageUrl, { waitUntil: 'networkidle2', timeout: 45000 });

            // 🎯 Audit Finding 6: Fixed scoping (relative to card)
            const listingResults = await page.evaluate((sel) => {
                const cards = document.querySelectorAll(sel.productCard);
                return Array.from(cards).map(card => {
                    const getField = (selector) => {
                        if (!selector) return null;
                        // Use card.querySelector for local scope
                        const el = card.querySelector(selector);
                        if (!el) return null;
                        if (el.tagName === 'A') return el.href;
                        if (el.tagName === 'IMG') return el.src;
                        return el.innerText.trim();
                    };

                    return {
                        title: getField(sel.title),
                        price: getField(sel.price),
                        link: getField(sel.productLink) || (card.tagName === 'A' ? card.href : card.querySelector('a')?.href)
                    };
                });
            }, selectors);

            // 🕵️ Deep Scrape
            if (deepScrape && listingResults.length > 0) {
                for (let i = 0; i < listingResults.length; i++) {
                    const item = listingResults[i];
                    if (item.link && item.link.startsWith('http')) {
                        let detailPage;
                        try {
                            detailPage = await browser.newPage();
                            await detailPage.goto(item.link, { waitUntil: 'networkidle2', timeout: 20000 });
                            const details = await detailPage.evaluate((ds) => {
                                const data = {};
                                Object.keys(ds).forEach(key => {
                                    const el = document.querySelector(ds[key]);
                                    data[key] = el ? el.innerText.trim() : 'N/A';
                                });
                                return data;
                            }, detailSelectors);
                            listingResults[i] = { ...item, ...details };
                        } catch (e) {
                            console.log(`⚠️ Detail Fail: ${item.link}`);
                        } finally {
                            // 🎯 Audit Finding 7: Always close detail page
                            if (detailPage) await detailPage.close();
                        }
                    }
                }
            }

            allResults = [...allResults, ...listingResults];
            pagesProcessed++;

            // Pagination
            if (selectors.nextPage && pagesProcessed < maxPages) {
                const nextUrl = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    return el ? (el.href || null) : null;
                }, selectors.nextPage);

                if (nextUrl && nextUrl !== currentPageUrl) {
                    currentPageUrl = nextUrl;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        res.json({ results: allResults, count: allResults.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`✅ Audited Server running on http://localhost:${PORT}`);
});
