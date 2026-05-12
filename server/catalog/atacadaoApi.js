const { normalizeUrl } = require('./utils');

const DEFAULT_SELLER = 'atacadaobr60';
const BLOCKED_FIRST_SEGMENTS = new Set([
  'aplicativo-meu-atacadao',
  'atendimento',
  'catalogo',
  'checkout',
  'institucional',
  'login',
  'orders',
  'secure',
  'whatsapp'
]);

function buildCategoryFacets(rawUrl, baseUrl) {
  const url = normalizeUrl(rawUrl, baseUrl);
  if (!url) return { url: rawUrl, selectedFacets: [] };
  const parsed = new URL(url);
  const segments = parsed.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment, index) => index > 0 || !BLOCKED_FIRST_SEGMENTS.has(segment));

  if (!segments.length) return { url, selectedFacets: [] };
  return {
    url,
    selectedFacets: segments.map((segment, index) => ({
      key: `category-${index + 1}`,
      value: segment
    }))
  };
}

function buildProductsVariables({ selectedFacets, seller = DEFAULT_SELLER, first = 50, after = '0' }) {
  const regionId = Buffer.from(`SW#${seller}`).toString('base64');
  return {
    first,
    after,
    sort: 'score_desc',
    term: '',
    selectedFacets: [
      ...selectedFacets,
      { key: 'region-id', value: regionId },
      { key: 'locale', value: 'pt-BR' }
    ]
  };
}

function buildProductsUrl(variables) {
  return `https://www.atacadao.com.br/api/graphql?operationName=ProductsQuery&variables=${encodeURIComponent(JSON.stringify(variables))}`;
}

function productUrlsFromEdges(edges, baseUrl) {
  return (edges || [])
    .map((edge) => edge?.node?.slug)
    .filter(Boolean)
    .map((slug) => normalizeUrl(`/${slug}/p`, baseUrl))
    .filter(Boolean);
}

function uniqFacets(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = JSON.stringify(item.selectedFacets);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

module.exports = {
  DEFAULT_SELLER,
  buildCategoryFacets,
  buildProductsVariables,
  buildProductsUrl,
  productUrlsFromEdges,
  uniqFacets
};
