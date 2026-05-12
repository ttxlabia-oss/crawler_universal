const cheerio = require('cheerio');
const { normalizeUrl, sameHost, uniq } = require('./utils');

function discoverWithProfile(html, pageUrl, retailer, profile) {
  const $ = cheerio.load(html);
  const categoryLinks = collectLinks($, pageUrl, retailer, profile?.category?.linkSelectors || [])
    .filter((url) => matchesAny(url, profile?.category?.urlPatterns || []));
  const productLinks = collectLinks($, pageUrl, retailer, profile?.listing?.productLinkSelectors || [])
    .filter((url) => matchesAny(url, profile?.listing?.productUrlPatterns || []));
  const paginationLinks = collectLinks($, pageUrl, retailer, profile?.listing?.paginationSelectors || []);
  const embeddedCategoryLinks = collectEmbeddedCategoryLinks($, pageUrl, retailer, profile);

  return {
    categoryLinks: uniq([...categoryLinks, ...embeddedCategoryLinks]),
    productLinks: uniq(productLinks),
    paginationLinks: uniq(paginationLinks),
    selectorHits: {
      category: countSelectorHits($, profile?.category?.linkSelectors || []),
      product: countSelectorHits($, profile?.listing?.productLinkSelectors || []),
      productCards: countSelectorHits($, profile?.listing?.productCardSelectors || []),
      pagination: countSelectorHits($, profile?.listing?.paginationSelectors || [])
    },
    samples: {
      categories: uniq([...categoryLinks, ...embeddedCategoryLinks]).slice(0, 10),
      products: uniq(productLinks).slice(0, 10),
      pagination: uniq(paginationLinks).slice(0, 10)
    }
  };
}

function collectLinks($, pageUrl, retailer, selectors) {
  const links = [];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const href = $(el).attr('href');
      const normalized = normalizeUrl(href, pageUrl);
      if (!normalized) return;
      if (!sameHost(normalized, retailer.baseUrl)) return;
      links.push(normalized);
    });
  }
  return uniq(links);
}

function collectEmbeddedCategoryLinks($, pageUrl, retailer, profile) {
  if (!profile?.category?.embeddedStatePaths?.length) return [];
  const links = [];
  const nextRaw = $('#__NEXT_DATA__').contents().text();
  if (!nextRaw) return links;

  try {
    const data = JSON.parse(nextRaw);
    walk(data, (node) => {
      if (!node || typeof node !== 'object') return;
      const href = node.href || node.url || node.link;
      if (!href) return;
      const normalized = normalizeUrl(href, pageUrl);
      if (!normalized || !sameHost(normalized, retailer.baseUrl)) return;
      if (matchesAny(normalized, profile.category.urlPatterns || [])) links.push(normalized);
    });
  } catch {
    return links;
  }

  return uniq(links);
}

function walk(node, visitor, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  visitor(node);
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visitor, seen));
    return;
  }
  Object.values(node).forEach((value) => walk(value, visitor, seen));
}

function matchesAny(url, patterns) {
  return patterns.some((pattern) => pattern.test(url));
}

function countSelectorHits($, selectors) {
  return selectors.reduce((acc, selector) => {
    acc[selector] = $(selector).length;
    return acc;
  }, {});
}

module.exports = {
  discoverWithProfile
};
