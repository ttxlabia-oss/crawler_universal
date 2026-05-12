const cheerio = require('cheerio');
const { normalizeUrl, parsePrice, truncate, uniq } = require('./utils');

function extractProduct(html, sourceUrl, retailer) {
  const $ = cheerio.load(html);
  const jsonLdProducts = extractJsonLdProducts($);
  const primary = jsonLdProducts[0] || {};
  const nextData = extractNextData($);
  const nextProduct = findProductLike(nextData) || {};

  const canonicalUrl = normalizeUrl(
    $('link[rel="canonical"]').attr('href') ||
      primary.url ||
      nextProduct.url ||
      sourceUrl,
    sourceUrl
  );

  const offer = normalizeOffer(primary.offers || nextProduct.offers || {});
  const images = uniq([
    ...asArray(primary.image),
    ...asArray(nextProduct.image),
    $('meta[property="og:image"]').attr('content')
  ].map((image) => normalizeUrl(image, sourceUrl)));

  const brand = normalizeBrand(primary.brand || nextProduct.brand);
  const name =
    text(primary.name) ||
    text(nextProduct.name) ||
    text($('meta[property="og:title"]').attr('content')) ||
    text($('h1').first().text());

  const description =
    text(primary.description) ||
    text(nextProduct.description) ||
    text($('meta[name="description"]').attr('content')) ||
    text($('meta[property="og:description"]').attr('content'));

  const sku = text(primary.sku || nextProduct.sku || nextProduct.productReference || nextProduct.itemId);
  const gtinEan = text(primary.gtin13 || primary.gtin || primary.gtin14 || nextProduct.gtin13 || nextProduct.ean);
  const externalId = extractExternalId(sourceUrl, sku, nextProduct);
  const categoryPath = extractCategoryPath(primary, nextProduct, $);

  return {
    retailer: retailer.key,
    sourceUrl,
    canonicalUrl,
    externalId,
    sku,
    gtinEan,
    name,
    brand,
    categoryPath,
    description,
    imageUrls: images,
    price: offer.price,
    listPrice: offer.listPrice,
    currency: offer.currency,
    availability: offer.availability,
    seller: offer.seller,
    rawStatic: {
      jsonLdProduct: primary,
      nextProduct,
      jsonLdProductCount: jsonLdProducts.length
    },
    rawOffer: offer.rawOffer || {}
  };
}

function extractProductLinks(html, pageUrl, retailer) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute) return;
    if (!new URL(absolute).hostname.endsWith(new URL(retailer.baseUrl).hostname)) return;
    if (retailer.productUrlPatterns.some((pattern) => pattern.test(absolute))) links.push(absolute);
  });
  return uniq(links);
}

function extractCategoryLinks(html, pageUrl, retailer) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute) return;
    if (!new URL(absolute).hostname.endsWith(new URL(retailer.baseUrl).hostname)) return;
    if ((retailer.categoryUrlPatterns || []).some((pattern) => pattern.test(absolute))) links.push(absolute);
  });
  return uniq(links);
}

function extractJsonLdProducts($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    for (const item of parseJsonMaybeMany(raw)) {
      collectProducts(item, products);
    }
  });
  return products;
}

function parseJsonMaybeMany(raw) {
  const values = [];
  if (!raw || !raw.trim()) return values;
  try {
    values.push(JSON.parse(raw));
    return values;
  } catch {
    // Some sites put multiple JSON-LD objects in the same script. Split conservatively.
  }

  const chunks = raw
    .replace(/}\s*{/g, '}\n{')
    .split(/\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    try {
      values.push(JSON.parse(chunk));
    } catch {
      // Ignore malformed non-product JSON-LD blocks.
    }
  }
  return values;
}

function collectProducts(node, products) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectProducts(item, products));
    return;
  }
  if (typeof node !== 'object') return;
  const type = node['@type'];
  if (isType(type, 'Product')) products.push(node);
  if (node['@graph']) collectProducts(node['@graph'], products);
  if (node.mainEntity) collectProducts(node.mainEntity, products);
  if (node.itemListElement) collectProducts(node.itemListElement, products);
  if (node.item) collectProducts(node.item, products);
}

function extractNextData($) {
  const raw = $('#__NEXT_DATA__').contents().text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findProductLike(root) {
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (looksLikeProduct(node)) return node;
    if (Array.isArray(node)) {
      for (const item of node) queue.push(item);
    } else {
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') queue.push(value);
      }
    }
  }
  return null;
}

function looksLikeProduct(node) {
  const keys = Object.keys(node);
  const hasName = keys.includes('name') || keys.includes('productName');
  const hasSku = keys.includes('sku') || keys.includes('productId') || keys.includes('itemId');
  const hasOffer = keys.includes('offers') || keys.includes('priceRange') || keys.includes('items');
  return hasName && (hasSku || hasOffer);
}

function normalizeOffer(rawOffer) {
  const offer = Array.isArray(rawOffer) ? rawOffer[0] : rawOffer;
  const nested = offer?.lowPrice || offer?.highPrice ? offer : offer?.offers || offer;
  const seller = normalizeSeller(nested?.seller);
  return {
    price: parsePrice(nested?.price ?? nested?.lowPrice ?? nested?.Price ?? nested?.spotPrice),
    listPrice: parsePrice(nested?.listPrice ?? nested?.highPrice ?? nested?.ListPrice),
    currency: text(nested?.priceCurrency || nested?.currency || nested?.Currency),
    availability: text(nested?.availability || nested?.Availability),
    seller,
    rawOffer: offer || {}
  };
}

function normalizeBrand(brand) {
  if (!brand) return null;
  if (typeof brand === 'string') return text(brand);
  return text(brand.name || brand.brandName);
}

function normalizeSeller(seller) {
  if (!seller) return null;
  if (typeof seller === 'string') return text(seller);
  return text(seller.name || seller.sellerName);
}

function extractExternalId(sourceUrl, sku, product) {
  if (product?.productId) return text(product.productId);
  if (product?.id) return text(product.id);
  if (sku) return sku;
  const match = sourceUrl.match(/(?:-|\/)(m[vp]\d+|mp\d+|\d{4,})(?:\/p)?(?:[/?#]|$)/i);
  return match ? match[1] : null;
}

function extractCategoryPath(primary, nextProduct, $) {
  const raw = primary.category || nextProduct.category || nextProduct.categories;
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean).join(' > ') || null;
  if (raw) return text(raw);
  const crumbs = [];
  $('[itemtype*="BreadcrumbList"] [itemprop="name"], nav a, .breadcrumb a').each((_, el) => {
    const value = text($(el).text());
    if (value) crumbs.push(value);
  });
  return uniq(crumbs).slice(0, 10).join(' > ') || null;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isType(type, expected) {
  if (Array.isArray(type)) return type.some((item) => isType(item, expected));
  return String(type || '').toLowerCase() === expected.toLowerCase();
}

function text(value) {
  if (value == null) return null;
  if (typeof value === 'object') return text(value.name || value.value || value['@id']);
  return truncate(value, 2000);
}

module.exports = {
  extractProduct,
  extractProductLinks,
  extractCategoryLinks
};
