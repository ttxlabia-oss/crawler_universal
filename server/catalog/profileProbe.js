const fs = require('fs');
const path = require('path');
const axiosModule = require('axios');
const puppeteer = require('puppeteer');
const { enabledRetailers } = require('./adapters');
const { getProfile } = require('./siteProfiles');
const { discoverWithProfile } = require('./profileDiscovery');
const { parseArgs, toInt } = require('./utils');

const axios = axiosModule.default || axiosModule;
const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 UniversalScraperProfileProbe/1.0';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const retailers = enabledRetailers(args.site || 'all');
  const maxPages = toInt(args['max-pages'], 6);
  const rows = [];

  for (const retailer of retailers) {
    const profile = getProfile(retailer.key);
    if (!profile) continue;
    const urls = [...new Set([...(profile.category.seedUrls || []), ...(retailer.seedPages || [])])].slice(0, maxPages);
    for (const url of urls) {
      try {
        const html = await fetchText(url, profile.fetchMode === 'browser');
        const result = discoverWithProfile(html, url, retailer, profile);
        rows.push({
          retailer: retailer.key,
          url,
          categoryLinks: result.categoryLinks.length,
          productLinks: result.productLinks.length,
          paginationLinks: result.paginationLinks.length,
          productCardHits: sumHits(result.selectorHits.productCards),
          categorySamples: result.samples.categories,
          productSamples: result.samples.products,
          paginationSamples: result.samples.pagination,
          status: 'ok'
        });
        console.log(`[profile:${retailer.key}] ${url} categories=${result.categoryLinks.length} products=${result.productLinks.length} pagination=${result.paginationLinks.length}`);
      } catch (err) {
        rows.push({
          retailer: retailer.key,
          url,
          categoryLinks: 0,
          productLinks: 0,
          paginationLinks: 0,
          productCardHits: 0,
          categorySamples: [],
          productSamples: [],
          paginationSamples: [],
          status: `failed: ${err.message}`
        });
        console.log(`[profile:${retailer.key}] failed ${url}: ${err.message}`);
      }
    }
  }

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const report = renderReport(rows);
  const file = path.join(EXPORT_DIR, 'PROFILE_AUDIT.md');
  fs.writeFileSync(file, report, 'utf8');
  console.log(`[profile] ${file}`);
}

async function fetchText(url, useBrowser) {
  if (useBrowser) return fetchTextWithBrowser(url);
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  return String(response.data);
}

async function fetchTextWithBrowser(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    return await page.content();
  } finally {
    if (browser) await browser.close();
  }
}

function renderReport(rows) {
  const lines = [
    '# Site Profile Audit',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| retailer | url | categories | products | pagination | product_card_hits | status |',
    '|---|---|---:|---:|---:|---:|---|'
  ];

  for (const row of rows) {
    lines.push(`| ${row.retailer} | ${row.url} | ${row.categoryLinks} | ${row.productLinks} | ${row.paginationLinks} | ${row.productCardHits} | ${row.status} |`);
  }

  lines.push('', '## Samples', '');
  for (const row of rows) {
    lines.push(`### ${row.retailer} - ${row.url}`, '');
    lines.push(`Category samples: ${row.categorySamples.slice(0, 5).join(', ') || 'none'}`);
    lines.push(`Product samples: ${row.productSamples.slice(0, 5).join(', ') || 'none'}`);
    lines.push(`Pagination samples: ${row.paginationSamples.slice(0, 5).join(', ') || 'none'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function sumHits(hitMap = {}) {
  return Object.values(hitMap).reduce((total, count) => total + Number(count || 0), 0);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
