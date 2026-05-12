const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const db = require('./catalogDb');
const { enabledRetailers, RETAILERS } = require('./adapters');
const {
  parseArgs,
  toInt,
  hash,
  normalizeUrl,
  sameHost,
  extractXmlLocs,
  looksLikeXml,
  uniq,
  sleep,
  csvEscape
} = require('./utils');
const { extractProduct, extractProductLinks, extractCategoryLinks } = require('./extractors');
const { getProfile } = require('./siteProfiles');
const { discoverWithProfile } = require('./profileDiscovery');
const {
  DEFAULT_SELLER: DEFAULT_ATACADAO_SELLER,
  buildCategoryFacets: buildAtacadaoCategoryFacets,
  buildProductsVariables: buildAtacadaoProductsVariables,
  buildProductsUrl: buildAtacadaoProductsUrl,
  productUrlsFromEdges: atacadaoProductUrlsFromEdges,
  uniqFacets
} = require('./atacadaoApi');

const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 UniversalScraperCatalog/1.0';
const LIVE_OBSERVED_SOURCE_SQL = `(
  pu.source_type LIKE '%category_page%' OR
  pu.source_type LIKE '%cartography%' OR
  pu.source_type LIKE '%api%' OR
  pu.source_type LIKE '%product_map%' OR
  pu.source_type LIKE '%manual%'
)`;
const SOURCE_TRUST_SQL = `CASE
  WHEN ${LIVE_OBSERVED_SOURCE_SQL} AND pu.source_type LIKE '%sitemap%' THEN 'observed_plus_sitemap'
  WHEN ${LIVE_OBSERVED_SOURCE_SQL} THEN 'observed_listing'
  ELSE 'sitemap_only_unverified'
END`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._ || process.argv[2] || 'help';
  await db.init();
  await seedRetailers();

  if (command === 'discover') {
    await runForSites(args, discoverRetailer);
  } else if (command === 'extract') {
    await runForSites(args, extractRetailer);
  } else if (command === 'all') {
    await runForSites(args, async (retailer, options) => {
      await discoverRetailer(retailer, options);
      await extractRetailer(retailer, options);
    });
  } else if (command === 'export') {
    await exportCsv(args);
  } else if (command === 'audit') {
    await audit(args);
  } else {
    printHelp();
  }
}

async function seedRetailers() {
  for (const retailer of RETAILERS) {
    await db.upsertRetailer(retailer);
  }
}

async function runForSites(args, fn) {
  const site = args.site || 'all';
  const retailers = enabledRetailers(site);
  const options = {
    limit: toInt(args.limit, 0),
    maxSitemaps: toInt(args['max-sitemaps'], 0),
    maxPages: toInt(args['max-pages'], 200),
    delayMs: toInt(args.delay, 350),
    browserFallback: Boolean(args.browser),
    fullDiscovery: Boolean(args.full),
    skipSitemaps: Boolean(args['skip-sitemaps']),
    apiPages: toInt(args['api-pages'], 3),
    apiPageSize: toInt(args['api-page-size'], 50),
    apiCategories: toInt(args['api-categories'], 50),
    apiFull: Boolean(args['api-full']),
    atacadaoSeller: args['atacadao-seller'] || DEFAULT_ATACADAO_SELLER,
    observedOnly: Boolean(args['observed-only']),
    exportAfter: args.export !== false && args.export !== 'false' && !args['no-export']
  };

  for (const retailer of retailers) {
    await fn(retailer, options);
  }

  if (options.exportAfter) await exportCsv({ site });
  await audit({ site });
}

async function discoverRetailer(retailer, options) {
  const retailerRow = await db.upsertRetailer(retailer);
  const runId = await db.createRun(retailerRow.id, 'discover', 'hybrid discovery: sitemap + seed/category pages');
  const seenSitemaps = new Set();
  const sitemapQueue = options.skipSitemaps ? [] : [...retailer.sitemapUrls];
  const profile = getProfile(retailer.key);
  const pageQueue = uniq([...(retailer.seedPages || []), ...(profile?.category?.seedUrls || [])]);
  let sourceCount = 0;

  console.log(`[discover:${retailer.key}] starting`);

  try {
    while (sitemapQueue.length) {
      if (options.maxSitemaps > 0 && sourceCount >= options.maxSitemaps) break;
      const sitemapUrl = sitemapQueue.shift();
      if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
      seenSitemaps.add(sitemapUrl);
      sourceCount += 1;
      await db.upsertDiscoverySource(retailerRow.id, { type: 'sitemap', url: sitemapUrl });

      try {
        const text = await fetchText(sitemapUrl, { browserFallback: options.browserFallback && retailer.key === 'paodeacucar' });
        const locs = extractXmlLocs(text);
        await db.updateDiscoverySource(retailerRow.id, 'sitemap', sitemapUrl, {
          status: 'ok',
          lastCheckedAt: new Date().toISOString(),
          lastSuccessAt: new Date().toISOString(),
          lastError: null
        });

        for (const loc of locs) {
          const normalized = normalizeUrl(loc, retailer.baseUrl);
          if (!normalized || !sameHost(normalized, retailer.baseUrl)) continue;
          if (looksLikeSitemap(normalized)) {
            if (shouldFollowSitemap(retailer, normalized, options)) sitemapQueue.push(normalized);
          } else if (isCategorySitemapSource(retailer, sitemapUrl)) {
            pageQueue.push(normalized);
          } else if (isCategoryUrl(retailer, normalized)) {
            pageQueue.push(normalized);
          }
        }

        const productUrls = locs
          .map((loc) => normalizeUrl(loc, retailer.baseUrl))
          .filter((normalized) => normalized && sameHost(normalized, retailer.baseUrl))
          .filter((normalized) => !looksLikeSitemap(normalized))
          .filter((normalized) => !isCategorySitemapSource(retailer, sitemapUrl))
          .filter((normalized) => isProductUrl(retailer, normalized));
        if (productUrls.length) {
          await saveProductUrls(retailerRow.id, productUrls, 'sitemap', sitemapUrl);
          await db.incrementRun(runId, 'urls_found', productUrls.length);
        }

        console.log(`[discover:${retailer.key}] sitemap ${sourceCount}: ${sitemapUrl} locs=${locs.length}`);
      } catch (err) {
        await db.updateDiscoverySource(retailerRow.id, 'sitemap', sitemapUrl, {
          status: 'failed',
          lastCheckedAt: new Date().toISOString(),
          lastError: err.message
        });
        await db.logError(runId, retailerRow.id, sitemapUrl, 'sitemap', 'FETCH_FAILED', err.message);
        console.log(`[discover:${retailer.key}] sitemap failed ${sitemapUrl}: ${err.message}`);
      }

      await sleep(options.delayMs);
    }

    const crawledPages = await crawlSeedPages(retailer, retailerRow.id, runId, pageQueue, options, profile);
    if (retailer.key === 'atacadao') {
      await discoverAtacadaoApi(retailer, retailerRow.id, runId, crawledPages, options);
    }
    await db.finishRun(runId, 'completed');
  } catch (err) {
    await db.logError(runId, retailerRow.id, retailer.baseUrl, 'discover', 'RUN_FAILED', err.message);
    await db.finishRun(runId, 'failed', err.message);
    throw err;
  }
}

async function crawlSeedPages(retailer, retailerId, runId, pageQueue, options, profile) {
  const seenPages = new Set();
  const crawledPages = [];
  let processed = 0;

  while (pageQueue.length && processed < options.maxPages) {
    const pageUrl = pageQueue.shift();
    const normalizedPage = normalizeUrl(pageUrl, retailer.baseUrl);
    if (!normalizedPage || seenPages.has(normalizedPage)) continue;
    if (!sameHost(normalizedPage, retailer.baseUrl)) continue;
    seenPages.add(normalizedPage);
    crawledPages.push(normalizedPage);
    processed += 1;

    try {
      const html = await fetchText(normalizedPage, {
        browserFallback: (options.browserFallback && retailer.key === 'paodeacucar') || profile?.fetchMode === 'browser'
      });
      const profileResult = discoverWithProfile(html, normalizedPage, retailer, profile);
      const productLinks = uniq([
        ...extractProductLinks(html, normalizedPage, retailer),
        ...profileResult.productLinks
      ]);
      const categoryLinks = uniq([
        ...extractCategoryLinks(html, normalizedPage, retailer),
        ...profileResult.categoryLinks,
        ...profileResult.paginationLinks
      ]);

      if (productLinks.length) {
        await saveProductUrls(retailerId, productLinks, 'category_page', normalizedPage);
        await db.incrementRun(runId, 'urls_found', productLinks.length);
      }
      for (const url of categoryLinks) {
        if (!seenPages.has(url) && pageQueue.length < options.maxPages * 5) pageQueue.push(url);
      }
      console.log(`[discover:${retailer.key}] page ${processed}: products=${productLinks.length} categories=${categoryLinks.length} profileCards=${sumHits(profileResult.selectorHits.productCards)} ${normalizedPage}`);
    } catch (err) {
      await db.logError(runId, retailerId, normalizedPage, 'category_page', 'FETCH_FAILED', err.message);
      console.log(`[discover:${retailer.key}] page failed ${normalizedPage}: ${err.message}`);
    }

    await sleep(options.delayMs);
  }

  return crawledPages;
}

async function discoverAtacadaoApi(retailer, retailerId, runId, categoryPages, options) {
  const categoryFacets = uniqFacets(
    categoryPages
      .map((url) => buildAtacadaoCategoryFacets(url, retailer.baseUrl))
      .filter((item) => item.selectedFacets.length)
  ).slice(0, options.apiCategories || categoryPages.length);

  if (!categoryFacets.length) {
    console.log('[discover:atacadao:api] no category facets found');
    return;
  }

  console.log(`[discover:atacadao:api] categories=${categoryFacets.length} pageSize=${options.apiPageSize} pages=${options.apiFull ? 'full' : options.apiPages}`);

  for (const item of categoryFacets) {
    let offset = 0;
    let page = 0;
    let totalCount = null;
    const maxPages = options.apiFull ? Number.POSITIVE_INFINITY : options.apiPages;

    while (page < maxPages) {
      const variables = buildAtacadaoProductsVariables({
        selectedFacets: item.selectedFacets,
        seller: options.atacadaoSeller,
        first: options.apiPageSize,
        after: String(offset)
      });
      const apiUrl = buildAtacadaoProductsUrl(variables);

      try {
        const response = await axios.get(apiUrl, {
          timeout: 30000,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            Referer: item.url
          },
          validateStatus: (status) => status >= 200 && status < 400
        });
        const products = response.data?.data?.search?.products;
        const edges = products?.edges || [];
        totalCount = Number(products?.pageInfo?.totalCount || totalCount || 0);
        const productUrls = atacadaoProductUrlsFromEdges(edges, retailer.baseUrl);

        if (productUrls.length) {
          await saveProductUrls(retailerId, productUrls, 'api', item.url);
          await db.incrementRun(runId, 'urls_found', productUrls.length);
        }

        page += 1;
        offset += options.apiPageSize;
        console.log(`[discover:atacadao:api] ${item.url} page=${page} products=${productUrls.length} total=${totalCount || ''}`);
        if (!edges.length || (totalCount && offset >= totalCount)) break;
      } catch (err) {
        await db.logError(runId, retailerId, item.url, 'category_api', 'FETCH_FAILED', err.message);
        console.log(`[discover:atacadao:api] failed ${item.url}: ${err.message}`);
        break;
      }

      await sleep(options.delayMs);
    }
  }
}

async function extractRetailer(retailer, options) {
  const retailerRow = await db.upsertRetailer(retailer);
  const runId = await db.createRun(retailerRow.id, 'extract', `limit=${options.limit || 'all'}`);
  const urls = await db.getUrlsForExtraction(retailerRow.id, options.limit, {
    observedOnly: options.observedOnly
  });

  console.log(`[extract:${retailer.key}] starting urls=${urls.length}`);
  try {
    for (let index = 0; index < urls.length; index += 1) {
      const item = urls[index];
      try {
        const html = await fetchText(item.url, { browserFallback: options.browserFallback && retailer.key === 'paodeacucar' });
        const product = extractProduct(html, item.url, retailer);
        if (!product.name && !product.sku && !product.externalId) {
          throw new Error('No product identity fields found');
        }
        const result = await db.upsertProduct(retailerRow.id, item.id, product);
        await db.markProductUrlFetched(item.id, 'active');
        await db.incrementRun(runId, 'urls_fetched');
        await db.incrementRun(runId, result.created ? 'products_created' : 'products_updated');
        if ((index + 1) % 25 === 0 || index === urls.length - 1) {
          console.log(`[extract:${retailer.key}] ${index + 1}/${urls.length}`);
        }
      } catch (err) {
        const status = isBlockedError(err) ? 'blocked' : 'failed';
        await db.markProductUrlFetched(item.id, status, err.message);
        await db.logError(runId, retailerRow.id, item.url, 'extract', status === 'blocked' ? 'BLOCKED' : 'PARSE_FAILED', err.message);
        console.log(`[extract:${retailer.key}] failed ${item.url}: ${err.message}`);
      }

      await sleep(options.delayMs);
    }
    await db.finishRun(runId, 'completed');
  } catch (err) {
    await db.logError(runId, retailerRow.id, retailer.baseUrl, 'extract', 'RUN_FAILED', err.message);
    await db.finishRun(runId, 'failed', err.message);
    throw err;
  }
}

async function fetchText(url, options = {}) {
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      maxContentLength: 25 * 1024 * 1024,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      validateStatus: (status) => status >= 200 && status < 400
    });
    return String(response.data);
  } catch (err) {
    if (!options.browserFallback) throw err;
    return fetchTextWithBrowser(url);
  }
}

async function fetchTextWithBrowser(url) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    return await page.content();
  } finally {
    if (browser) await browser.close();
  }
}

function shouldFollowSitemap(retailer, url, options) {
  if (options.fullDiscovery) return true;
  if (retailer.productSitemapPattern && retailer.productSitemapPattern.test(url)) return true;
  if (retailer.categorySitemapPattern && retailer.categorySitemapPattern.test(url)) return true;
  return !/brand-|custom-|user-routes|apps-routes/i.test(url);
}

function isCategorySitemapSource(retailer, url) {
  if (retailer.categorySitemapPattern && retailer.categorySitemapPattern.test(url)) return true;
  return /categorias|category/i.test(url) && !/product|produto/i.test(url);
}

function looksLikeSitemap(url) {
  return /\.xml(?:$|[?#])|sitemap/i.test(url);
}

function isProductUrl(retailer, url) {
  return retailer.productUrlPatterns.some((pattern) => pattern.test(url));
}

function isCategoryUrl(retailer, url) {
  return (retailer.categoryUrlPatterns || []).some((pattern) => pattern.test(url));
}

async function saveProductUrl(retailerId, url, sourceType, sourceUrl) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  return db.upsertProductUrl(retailerId, {
    url: normalized,
    canonicalUrl: normalized,
    sourceType,
    sourceUrl,
    urlHash: hash(normalized)
  });
}

async function saveProductUrls(retailerId, urls, sourceType, sourceUrl) {
  const items = uniq(urls)
    .map((url) => normalizeUrl(url))
    .filter(Boolean)
    .map((url) => ({
      url,
      canonicalUrl: url,
      sourceType,
      sourceUrl,
      urlHash: hash(url)
    }));
  if (!items.length) return 0;
  return db.upsertProductUrls(retailerId, items);
}

function isBlockedError(err) {
  const status = err?.response?.status;
  return status === 401 || status === 403 || status === 429;
}

function sumHits(hitMap = {}) {
  return Object.values(hitMap).reduce((total, count) => total + Number(count || 0), 0);
}

async function exportCsv(args) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const site = args.site || 'all';
  const retailers = enabledRetailers(site);
  for (const retailer of retailers) {
    await exportRetailerProducts(retailer, args, {
      file: path.join(EXPORT_DIR, `${retailer.key}_products.csv`),
      observedOnly: false
    });
    await exportRetailerProducts(retailer, args, {
      file: path.join(EXPORT_DIR, `${retailer.key}_observed_products.csv`),
      observedOnly: true
    });
  }
  await exportSiteMapCsv(args);
}

async function exportRetailerProducts(retailer, args, options) {
  const columns = [
    'retailer',
    'url_status',
    'source_trust',
    'source_url',
    'canonical_url',
    'external_id',
    'sku',
    'gtin_ean',
    'name',
    'brand',
    'category_path',
    'description',
    'image_urls',
    'price',
    'list_price',
    'currency',
    'availability',
    'seller',
    'source_type',
    'first_seen_at',
    'last_seen_at',
    'last_fetched_at',
    'captured_at',
    'last_error'
  ];
  const stream = fs.createWriteStream(options.file, 'utf8');
  stream.write(`${columns.join(',')}\n`);

  let lastProductUrlId = 0;
  let written = 0;
  const batchSize = toInt(args['batch-size'], 10000);
  const observedClause = options.observedOnly ? `AND ${LIVE_OBSERVED_SOURCE_SQL}` : '';

  while (true) {
    const rows = await db.all(
      `SELECT
        pu.id AS product_url_id,
        r.key AS retailer,
        pu.status AS url_status,
        ${SOURCE_TRUST_SQL} AS source_trust,
        pu.url AS source_url,
        pu.source_type,
        pu.first_seen_at,
        pu.last_seen_at,
        pu.last_fetched_at,
        pu.last_error,
        p.canonical_url,
        p.external_id,
        p.sku,
        p.gtin_ean,
        p.name,
        p.brand,
        p.category_path,
        p.description,
        p.image_urls_json,
        latest.price,
        latest.list_price,
        latest.currency,
        latest.availability,
        latest.seller,
        latest.captured_at
      FROM retailers r
      JOIN product_urls pu ON pu.retailer_id = r.id
      LEFT JOIN products p ON p.product_url_id = pu.id
      LEFT JOIN product_snapshots latest ON latest.id = (
        SELECT ps.id
        FROM product_snapshots ps
        WHERE ps.product_id = p.id
        ORDER BY ps.captured_at DESC, ps.id DESC
        LIMIT 1
      )
      WHERE r.key = ? AND pu.id > ?
      ${observedClause}
      ORDER BY pu.id
      LIMIT ?`,
      [retailer.key, lastProductUrlId, batchSize]
    );
    if (!rows.length) break;
    for (const row of rows) {
      lastProductUrlId = row.product_url_id;
      let imageUrls = '';
      try {
        imageUrls = JSON.parse(row.image_urls_json || '[]').join('|');
      } catch {
        imageUrls = row.image_urls_json || '';
      }
      const values = {
        ...row,
        image_urls: imageUrls
      };
      stream.write(`${columns.map((column) => csvEscape(values[column])).join(',')}\n`);
      written += 1;
    }
    if (written > 0 && written % 100000 === 0) console.log(`[export:${retailer.key}] rows=${written}`);
  }
  await new Promise((resolve) => stream.end(resolve));
  console.log(`[export] ${options.file} rows=${written}`);
}

async function exportSiteMapCsv(args) {
  const site = args.site || 'all';
  const siteFilter = site === 'all' ? '' : 'WHERE r.key = ?';
  const params = site === 'all' ? [] : [site];

  const nodeColumns = [
    'retailer',
    'node_type',
    'url',
    'parent_url',
    'depth',
    'category_count',
    'product_count',
    'pagination_count',
    'last_mapped_at'
  ];
  const nodeRows = await db.all(
    `SELECT r.key AS retailer, n.node_type, n.url, n.parent_url, n.depth,
      n.category_count, n.product_count, n.pagination_count, n.last_mapped_at
     FROM site_map_nodes n
     JOIN retailers r ON r.id = n.retailer_id
     ${siteFilter}
     ORDER BY r.key, n.node_type, n.url`,
    params
  );
  await writeRowsCsv(path.join(EXPORT_DIR, 'site_map_nodes.csv'), nodeColumns, nodeRows);

  const edgeColumns = ['retailer', 'from_url', 'to_url', 'edge_type', 'first_seen_at', 'last_seen_at'];
  const edgeRows = await db.all(
    `SELECT r.key AS retailer, e.from_url, e.to_url, e.edge_type, e.first_seen_at, e.last_seen_at
     FROM site_map_edges e
     JOIN retailers r ON r.id = e.retailer_id
     ${siteFilter}
     ORDER BY r.key, e.edge_type, e.from_url, e.to_url`,
    params
  );
  await writeRowsCsv(path.join(EXPORT_DIR, 'site_map_edges.csv'), edgeColumns, edgeRows);
}

async function writeRowsCsv(file, columns, rows) {
  const stream = fs.createWriteStream(file, 'utf8');
  stream.write(`${columns.join(',')}\n`);
  for (const row of rows) stream.write(`${columns.map((column) => csvEscape(row[column])).join(',')}\n`);
  await new Promise((resolve) => stream.end(resolve));
  console.log(`[export] ${file} rows=${rows.length}`);
}

async function audit(args) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const site = args.site || 'all';
  const coverageRows = await db.coverage();
  const sourceRows = await db.sourceBreakdown();
  const trustRows = await sourceTrustBreakdown();
  const mapRows = await db.siteMapSummary();
  const filteredCoverage = site === 'all' ? coverageRows : coverageRows.filter((row) => row.retailer === site);
  const filteredSources = site === 'all' ? sourceRows : sourceRows.filter((row) => row.retailer === site);
  const filteredTrust = site === 'all' ? trustRows : trustRows.filter((row) => row.retailer === site);
  const filteredMap = site === 'all' ? mapRows : mapRows.filter((row) => row.retailer === site);

  console.table(filteredCoverage);
  console.table(filteredSources);
  console.table(filteredTrust);
  console.table(filteredMap);

  const report = [
    '# Catalog Crawl Audit',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Coverage',
    '',
    '| retailer | unique_product_urls | products | snapshots | queued_urls | active_urls | failed_urls | blocked_urls | last_fetched_at |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...filteredCoverage.map((row) =>
      `| ${row.retailer} | ${row.unique_product_urls || 0} | ${row.products || 0} | ${row.snapshots || 0} | ${row.queued_urls || 0} | ${row.active_urls || 0} | ${row.failed_urls || 0} | ${row.blocked_urls || 0} | ${row.last_fetched_at || ''} |`
    ),
    '',
    '## Source Breakdown',
    '',
    '| retailer | source_type | urls |',
    '|---|---|---:|',
    ...filteredSources.map((row) => `| ${row.retailer} | ${row.source_type} | ${row.urls} |`),
    '',
    '## Source Trust',
    '',
    '| retailer | source_trust | urls | extracted_products | active_urls | queued_urls | failed_urls |',
    '|---|---|---:|---:|---:|---:|---:|',
    ...filteredTrust.map((row) =>
      `| ${row.retailer} | ${row.source_trust} | ${row.urls || 0} | ${row.extracted_products || 0} | ${row.active_urls || 0} | ${row.queued_urls || 0} | ${row.failed_urls || 0} |`
    ),
    '',
    '## Site Map Graph',
    '',
    '| retailer | node_type | nodes | category_links_seen | product_links_seen | pagination_links_seen |',
    '|---|---|---:|---:|---:|---:|',
    ...filteredMap.map((row) =>
      `| ${row.retailer} | ${row.node_type} | ${row.nodes || 0} | ${row.category_links_seen || 0} | ${row.product_links_seen || 0} | ${row.pagination_links_seen || 0} |`
    ),
    '',
    '## Audit Notes',
    '',
    '- Sitemaps are treated as seeds, not proof of completeness.',
    '- Completeness is assessed by comparing sitemap, category/page, and extraction counts.',
    '- Rows with `url_status=queued` were discovered but not extracted yet.',
    '- Rows with `source_trust=sitemap_only_unverified` are sitemap seeds that still need live listing/API confirmation or product-page extraction.',
    '- Rows with `source_trust=observed_listing` or `observed_plus_sitemap` were seen through category/cartography/API/manual discovery and are more reliable than sitemap-only rows.',
    '- Rows with `url_status=blocked` or `failed` need retry, browser fallback, region context, or adapter work.',
    '- Pao de Acucar and grocery offers may require CEP/store context for complete price/stock data.',
    '- Carrefour is a very large marketplace catalog; full extraction requires long resumable batches.'
  ].join('\n');

  const file = path.join(EXPORT_DIR, 'AUDIT_REPORT.md');
  fs.writeFileSync(file, report, 'utf8');
  console.log(`[audit] ${file}`);
}

async function sourceTrustBreakdown() {
  return db.all(`SELECT
      retailer,
      source_trust,
      COUNT(*) AS urls,
      SUM(CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END) AS extracted_products,
      SUM(CASE WHEN url_status = 'active' THEN 1 ELSE 0 END) AS active_urls,
      SUM(CASE WHEN url_status = 'queued' THEN 1 ELSE 0 END) AS queued_urls,
      SUM(CASE WHEN url_status = 'failed' THEN 1 ELSE 0 END) AS failed_urls
    FROM (
      SELECT
        r.key AS retailer,
        pu.status AS url_status,
        p.id AS product_id,
        ${SOURCE_TRUST_SQL} AS source_trust
      FROM product_urls pu
      JOIN retailers r ON r.id = pu.retailer_id
      LEFT JOIN products p ON p.product_url_id = pu.id
    )
    GROUP BY retailer, source_trust
    ORDER BY retailer, urls DESC`);
}

function printHelp() {
  console.log(`Usage:
  node server/catalog/catalogCli.js discover --site all [--max-sitemaps 0] [--max-pages 200] [--browser]
  node server/catalog/catalogCli.js discover --site all --skip-sitemaps --max-pages 200 [--browser]
  node server/catalog/catalogCli.js discover --site atacadao --skip-sitemaps --api-pages 3 --api-categories 50
  node server/catalog/catalogCli.js extract --site casadabebida [--limit 500] [--browser] [--observed-only] [--no-export]
  node server/catalog/catalogCli.js all --site all [--limit 500]
  node server/catalog/catalogCli.js export --site all
  node server/catalog/catalogCli.js audit --site all
`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
