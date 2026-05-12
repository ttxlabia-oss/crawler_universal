const RETAILERS = [
  {
    key: 'paodeacucar',
    name: 'Pao de Acucar',
    baseUrl: 'https://www.paodeacucar.com',
    adapter: 'paodeacucar',
    sitemapUrls: [
      'https://www.paodeacucar.com/sitemap.xml',
      'https://www.paodeacucar.com/sitemapProduto.sdex'
    ],
    seedPages: [
      'https://www.paodeacucar.com/',
      'https://www.paodeacucar.com/mapa-de-produtos',
      'https://www.paodeacucar.com/mapa-de-categorias'
    ],
    productUrlPatterns: [/\/p(?:$|[/?#])/, /\/produto\/\d+\//i],
    blockedNotes: 'Frequently returns 403 to direct HTTP. Browser fallback may be required.'
  },
  {
    key: 'atacadao',
    name: 'Atacadao',
    baseUrl: 'https://www.atacadao.com.br',
    adapter: 'atacadao',
    sitemapUrls: ['https://www.atacadao.com.br/sitemap.xml'],
    seedPages: ['https://www.atacadao.com.br/'],
    productUrlPatterns: [/\/p(?:$|[/?#])/],
    productSitemapPattern: /\/sitemap\/product-\d+\.xml$/i,
    categorySitemapPattern: /\/sitemap\/category-\d+\.xml$/i
  },
  {
    key: 'malelu',
    name: 'Malelu',
    baseUrl: 'https://malelu.com.br',
    adapter: 'malelu',
    sitemapUrls: ['https://malelu.com.br/sitemap.xml'],
    seedPages: ['https://malelu.com.br/', 'https://malelu.com.br/shop/'],
    productUrlPatterns: [/\/shop\/[^/?#]+\/?$/i],
    categoryUrlPatterns: [/\/product-category\//i]
  },
  {
    key: 'casadabebida',
    name: 'Casa da Bebida',
    baseUrl: 'https://www.casadabebida.com.br',
    adapter: 'casadabebida',
    sitemapUrls: [
      'https://www.casadabebida.com.br/sitemaps/produtos.xml',
      'https://www.casadabebida.com.br/sitemaps/categorias.xml'
    ],
    seedPages: ['https://www.casadabebida.com.br/'],
    productUrlPatterns: [
      /^https:\/\/www\.casadabebida\.com\.br\/(?!sitemaps|login|carrinho|meu-cadastro|meus-pedidos|meus-enderecos|novo-cadastro|chat|includes|actions|class|templates)[^?#]+\/[^?#]+\/?$/i
    ],
    categoryUrlPatterns: [/\/sitemaps\/categorias\.xml$/i]
  },
  {
    key: 'carrefour',
    name: 'Carrefour',
    baseUrl: 'https://www.carrefour.com.br',
    adapter: 'carrefour',
    sitemapUrls: ['https://www.carrefour.com.br/sitemap.xml'],
    seedPages: ['https://www.carrefour.com.br/'],
    productUrlPatterns: [/\/p(?:$|[/?#])/, /\/produto\//i],
    productSitemapPattern: /\/sitemap\/product-\d+\.xml$/i,
    categorySitemapPattern: /\/sitemap\/category-\d+\.xml$/i,
    scaleNotes: 'Very large marketplace catalog. Full extraction requires long resumable batches.'
  }
];

function getRetailer(key) {
  return RETAILERS.find((retailer) => retailer.key === key);
}

function enabledRetailers(site) {
  if (!site || site === 'all') return RETAILERS;
  const retailer = getRetailer(site);
  if (!retailer) throw new Error(`Unknown site "${site}". Use one of: ${RETAILERS.map((r) => r.key).join(', ')}`);
  return [retailer];
}

module.exports = {
  RETAILERS,
  getRetailer,
  enabledRetailers
};
