const fs = require('fs');
const path = require('path');
const axiosModule = require('axios');
const puppeteer = require('puppeteer');
const { enabledRetailers } = require('./adapters');
const { getProfile } = require('./siteProfiles');
const { discoverWithProfile } = require('./profileDiscovery');
const { extractProduct } = require('./extractors');
const { parseArgs, toInt, normalizeUrl, uniq, hash } = require('./utils');
const db = require('./catalogDb');
const {
  DEFAULT_SELLER: DEFAULT_ATACADAO_SELLER,
  buildCategoryFacets: buildAtacadaoCategoryFacets,
  buildProductsVariables: buildAtacadaoProductsVariables,
  buildProductsUrl: buildAtacadaoProductsUrl,
  productUrlsFromEdges: atacadaoProductUrlsFromEdges
} = require('./atacadaoApi');

const axios = axiosModule.default || axiosModule;
const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 UniversalScraperCartography/1.0';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const retailers = enabledRetailers(args.site || 'all');
  await db.init();
  const options = {
    maxCategories: toInt(args['max-categories'], 40),
    maxProductsPerPage: toInt(args['max-products-per-page'], 12),
    maxProducts: toInt(args['max-products'], 0),
    maxDepth: toInt(args.depth, 2),
    detailSamples: toInt(args['detail-samples'], 3),
    scrollSteps: toInt(args['scroll-steps'], 5),
    apiPageSize: toInt(args['api-page-size'], 24),
    atacadaoSeller: args['atacadao-seller'] || DEFAULT_ATACADAO_SELLER,
    persist: args.persist !== false
  };

  const report = {
    generatedAt: new Date().toISOString(),
    objective: 'Map site structure as root pages, category/list pages, product links, pagination, and detail field signals.',
    retailers: {}
  };

  for (const retailer of retailers) {
    const profile = getProfile(retailer.key);
    if (!profile) continue;
    report.retailers[retailer.key] = await mapRetailer(retailer, profile, options);
  }

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const jsonFile = path.join(EXPORT_DIR, 'SITE_CARTOGRAPHY.json');
  const mdFile = path.join(EXPORT_DIR, 'SITE_CARTOGRAPHY.md');
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdFile, renderMarkdown(report), 'utf8');
  console.log(`[cartography] ${jsonFile}`);
  console.log(`[cartography] ${mdFile}`);
}

async function mapRetailer(retailer, profile, options) {
  console.log(`[cartography:${retailer.key}] starting`);
  const retailerRow = await db.upsertRetailer(retailer);
  const rootUrls = uniq([...(profile.category.seedUrls || [])]);
  const result = {
    baseUrl: retailer.baseUrl,
    fetchMode: profile.fetchMode,
    roots: [],
    discoveredCategoryUrls: [],
    discoveredProductUrls: [],
    detailSamples: [],
    notes: []
  };

  const categoryQueue = [];
  const visited = new Set();

  for (const rootUrl of rootUrls) {
    const node = await mapPage(retailer, profile, rootUrl, options);
    if (retailer.key === 'atacadao') await addAtacadaoApiProductsToNode(retailer, node, options);
    result.roots.push(node);
    if (options.persist) await persistMapNode(retailerRow.id, node, 'root', null, 0);
    categoryQueue.push(...node.categoryLinks);
    result.discoveredProductUrls.push(...node.productLinks);
    if (options.persist) await persistEdges(retailerRow.id, node);
  }

  let depth = 0;
  while (categoryQueue.length && result.discoveredCategoryUrls.length < options.maxCategories && depth < options.maxDepth * options.maxCategories) {
    depth += 1;
    const categoryUrl = categoryQueue.shift();
    if (!categoryUrl || visited.has(categoryUrl)) continue;
    visited.add(categoryUrl);
    const node = await mapPage(retailer, profile, categoryUrl, options);
    if (retailer.key === 'atacadao') await addAtacadaoApiProductsToNode(retailer, node, options);
    if (options.persist) await persistMapNode(retailerRow.id, node, 'category', categoryUrl, 1);
    result.discoveredCategoryUrls.push({
      url: categoryUrl,
      categoryLinksCount: node.categoryLinks.length,
      productLinksCount: node.productLinks.length,
      paginationLinksCount: node.paginationLinks.length,
      productSamples: node.productLinks.slice(0, options.maxProductsPerPage),
      paginationSamples: node.paginationLinks.slice(0, 5),
      selectorHits: node.selectorHits
    });
    result.discoveredProductUrls.push(...node.productLinks);
    if (options.persist) await persistEdges(retailerRow.id, node);
    categoryQueue.push(...node.categoryLinks, ...node.paginationLinks);
  }

  result.discoveredCategoryUrls = dedupeObjectsByUrl(result.discoveredCategoryUrls);
  result.discoveredProductUrls = uniq(result.discoveredProductUrls);
  if (options.maxProducts > 0) {
    result.discoveredProductUrls = result.discoveredProductUrls.slice(0, options.maxProducts);
  }
  if (options.persist && result.discoveredProductUrls.length) {
    await db.upsertProductUrls(
      retailerRow.id,
      result.discoveredProductUrls.map((url) => ({
        url,
        canonicalUrl: url,
        sourceType: retailer.key === 'atacadao' ? 'api' : 'cartography',
        sourceUrl: retailer.baseUrl,
        urlHash: hash(url)
      }))
    );
  }

  for (const productUrl of result.discoveredProductUrls.slice(0, options.detailSamples)) {
    try {
      const html = await fetchText(productUrl, profile.fetchMode === 'browser', options);
      const product = extractProduct(html, productUrl, retailer);
      result.detailSamples.push({
        url: productUrl,
        fieldsFound: Object.fromEntries(
          ['name', 'sku', 'gtinEan', 'brand', 'categoryPath', 'description', 'price', 'currency', 'availability', 'imageUrls'].map((field) => [
            field,
            field === 'imageUrls' ? Boolean(product.imageUrls?.length) : product[field] != null && product[field] !== ''
          ])
        ),
        sample: {
          name: product.name,
          sku: product.sku,
          brand: product.brand,
          price: product.price,
          currency: product.currency,
          availability: product.availability,
          images: product.imageUrls?.slice(0, 3) || []
        }
      });
    } catch (err) {
      result.detailSamples.push({ url: productUrl, error: err.message });
    }
  }

  if (retailer.key === 'paodeacucar') {
    result.notes.push('Pao de Acucar renders product rails dynamically and repeats only a few products on broad category pages without deeper API/network discovery or store context.');
  }
  if (retailer.key === 'atacadao') {
    result.notes.push('Atacadao listing pages expose products through a public GraphQL ProductsQuery; category HTML alone has no product anchors.');
  }
  if (retailer.key === 'carrefour') {
    result.notes.push('Carrefour sitemap inventory is much larger than category-observed products; stale or discontinued sitemap URLs should be expected.');
  }

  result.discoveredProductCount = result.discoveredProductUrls.length;
  result.discoveredCategoryCount = result.discoveredCategoryUrls.length;
  console.log(`[cartography:${retailer.key}] categories=${result.discoveredCategoryCount} productSamples=${result.discoveredProductCount}`);
  return result;
}

async function addAtacadaoApiProductsToNode(retailer, node, options) {
  const facets = buildAtacadaoCategoryFacets(node.url, retailer.baseUrl);
  if (!facets.selectedFacets.length) return;

  try {
    const variables = buildAtacadaoProductsVariables({
      selectedFacets: facets.selectedFacets,
      seller: options.atacadaoSeller,
      first: options.apiPageSize,
      after: '0'
    });
    const response = await axios.get(buildAtacadaoProductsUrl(variables), {
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        Referer: node.url
      }
    });
    const edges = response.data?.data?.search?.products?.edges || [];
    const productUrls = atacadaoProductUrlsFromEdges(edges, retailer.baseUrl);
    node.productLinks = uniq([...node.productLinks, ...productUrls]);
    node.samples = {
      ...node.samples,
      products: uniq([...(node.samples?.products || []), ...productUrls]).slice(0, 10),
      atacadaoApiTotalCount: response.data?.data?.search?.products?.pageInfo?.totalCount || null
    };
  } catch (err) {
    node.samples = {
      ...node.samples,
      atacadaoApiError: err.message
    };
  }
}

async function persistMapNode(retailerId, node, nodeType, parentUrl, depth) {
  await db.upsertSiteMapNode(retailerId, {
    url: node.url,
    nodeType,
    parentUrl,
    depth,
    categoryCount: node.categoryLinks.length,
    productCount: node.productLinks.length,
    paginationCount: node.paginationLinks.length,
    selectorHits: node.selectorHits,
    samples: node.samples
  });
}

async function persistEdges(retailerId, node) {
  for (const toUrl of node.categoryLinks) {
    await db.upsertSiteMapEdge(retailerId, { fromUrl: node.url, toUrl, edgeType: 'category' });
  }
  for (const toUrl of node.productLinks) {
    await db.upsertSiteMapEdge(retailerId, { fromUrl: node.url, toUrl, edgeType: 'product' });
  }
  for (const toUrl of node.paginationLinks) {
    await db.upsertSiteMapEdge(retailerId, { fromUrl: node.url, toUrl, edgeType: 'pagination' });
  }
}

async function mapPage(retailer, profile, url, options) {
  try {
    const html = await fetchText(url, profile.fetchMode === 'browser', options);
    const discovery = discoverWithProfile(html, url, retailer, profile);
    return {
      url,
      categoryLinks: discovery.categoryLinks,
      productLinks: discovery.productLinks,
      paginationLinks: discovery.paginationLinks,
      selectorHits: discovery.selectorHits,
      samples: discovery.samples
    };
  } catch (err) {
    return {
      url,
      error: err.message,
      categoryLinks: [],
      productLinks: [],
      paginationLinks: [],
      selectorHits: {},
      samples: {}
    };
  }
}

async function fetchText(url, useBrowser, options) {
  if (useBrowser) return fetchTextWithBrowser(url, options);
  const response = await axios.get(url, {
    timeout: 30000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });
  return String(response.data);
}

async function fetchTextWithBrowser(url, options) {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    for (let i = 0; i < options.scrollSteps; i += 1) {
      await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.8)));
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await page.content();
  } finally {
    if (browser) await browser.close();
  }
}

function dedupeObjectsByUrl(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const url = normalizeUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ ...item, url });
  }
  return result;
}

function renderMarkdown(report) {
  const lines = [
    '# Site Cartography',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This report maps each retailer as a tree: root pages, category/listing pages, product links, pagination links, and detail field samples.',
    ''
  ];

  for (const [key, retailer] of Object.entries(report.retailers)) {
    lines.push(`## ${key}`, '');
    lines.push(`Base URL: ${retailer.baseUrl}`);
    lines.push(`Fetch mode: ${retailer.fetchMode}`);
    lines.push(`Mapped category/listing nodes: ${retailer.discoveredCategoryCount}`);
    lines.push(`Unique product sample URLs retained: ${retailer.discoveredProductCount}`);
    if (retailer.notes?.length) {
      lines.push('', 'Notes:');
      retailer.notes.forEach((note) => lines.push(`- ${note}`));
    }
    lines.push('', '### Root Pages', '');
    lines.push('| url | categories | products | pagination |');
    lines.push('|---|---:|---:|---:|');
    for (const root of retailer.roots) {
      lines.push(`| ${root.url} | ${root.categoryLinks.length} | ${root.productLinks.length} | ${root.paginationLinks.length} |`);
    }
    lines.push('', '### Category/List Samples', '');
    lines.push('| url | categories | products | pagination | first_products |');
    lines.push('|---|---:|---:|---:|---|');
    for (const node of retailer.discoveredCategoryUrls.slice(0, 20)) {
      lines.push(`| ${node.url} | ${node.categoryLinksCount} | ${node.productLinksCount} | ${node.paginationLinksCount} | ${(node.productSamples || []).slice(0, 3).join('<br>')} |`);
    }
    lines.push('', '### Detail Field Samples', '');
    lines.push('| url | name | sku | price | availability | images | error |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const sample of retailer.detailSamples) {
      lines.push(`| ${sample.url} | ${sample.sample?.name || ''} | ${sample.sample?.sku || ''} | ${sample.sample?.price ?? ''} | ${sample.sample?.availability || ''} | ${(sample.sample?.images || []).length} | ${sample.error || ''} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
