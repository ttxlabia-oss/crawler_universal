const SITE_PROFILES = {
  paodeacucar: {
    key: 'paodeacucar',
    fetchMode: 'browser',
    category: {
      seedUrls: [
        'https://www.paodeacucar.com/',
        'https://www.paodeacucar.com/mapa-de-produtos',
        'https://www.paodeacucar.com/mapa-de-categorias',
        'https://www.paodeacucar.com/sitemap/mapa-de-categorias'
      ],
      linkSelectors: [
        'a[href*="/categoria/"]',
        'a[href*="/secoes/"]',
        'a[href*="/especial/"]'
      ],
      urlPatterns: [
        /\/categoria\//i,
        /\/secoes\//i,
        /\/especial\//i
      ]
    },
    listing: {
      productCardSelectors: [
        'a[href*="/produto/"]',
        'article',
        '[data-testid*="product"]'
      ],
      productLinkSelectors: ['a[href*="/produto/"]'],
      paginationSelectors: [
        'a[href*="p="]',
        'a[aria-label*="Próxima"]',
        'a[aria-label*="Proxima"]'
      ],
      productUrlPatterns: [/\/produto\/\d+\//i]
    },
    detail: {
      nameSelectors: ['h1', '[data-testid*="product-title"]'],
      priceSelectors: ['[data-testid*="price"]', '[class*="price"]'],
      imageSelectors: ['img[alt][src]', 'img[alt][data-src]'],
      structuredDataFirst: true
    }
  },

  atacadao: {
    key: 'atacadao',
    fetchMode: 'http',
    category: {
      seedUrls: ['https://www.atacadao.com.br/', 'https://www.atacadao.com.br/catalogo'],
      linkSelectors: [
        'a[href^="/"][href*="/"]',
        'a[href*="/mercearia"]',
        'a[href*="/bebidas"]',
        'a[href*="/limpeza"]'
      ],
      embeddedStatePaths: [
        '__NEXT_DATA__.props.pageProps.cmsSeo.sections[].data.menuItems[]',
        '__NEXT_DATA__.props.pageProps.cmsMenuCategory.menu.menuCategories.menuItems[]'
      ],
      urlPatterns: [/https:\/\/www\.atacadao\.com\.br\/(?!checkout|account|login|orders|busca|api|secure|institucional|aplicativo|whatsapp|catalogo)([a-z0-9-]+)(\/[a-z0-9-]+)*\/?$/i]
    },
    listing: {
      productCardSelectors: ['a[href$="/p"]', 'a[href*="/p?"]'],
      productLinkSelectors: ['a[href$="/p"]', 'a[href*="/p?"]'],
      paginationSelectors: ['a[href*="page="]', 'a[aria-label*="Próxima"]'],
      productUrlPatterns: [/\/p(?:$|[/?#])/i]
    },
    detail: {
      nameSelectors: ['h1', '[data-testid*="product"] h1'],
      priceSelectors: ['[data-testid*="price"]', '[class*="price"]'],
      skuSelectors: ['[class*="sku"]'],
      imageSelectors: ['img[alt][src]'],
      structuredDataFirst: true,
      embeddedStateFirst: true
    }
  },

  malelu: {
    key: 'malelu',
    fetchMode: 'http',
    category: {
      seedUrls: [
        'https://malelu.com.br/',
        'https://malelu.com.br/shop/',
        'https://malelu.com.br/product-category/bebidas/'
      ],
      linkSelectors: [
        'a[href*="/product-category/"]',
        '.menu-item-object-product_cat a[href]',
        '.product-categories a[href]'
      ],
      urlPatterns: [/\/product-category\//i]
    },
    listing: {
      productCardSelectors: [
        'li.product',
        '.product',
        '.elementor-widget-woocommerce-products .product'
      ],
      productLinkSelectors: ['a[href*="/shop/"]'],
      paginationSelectors: ['a.page-numbers', 'a.next'],
      productUrlPatterns: [/\/shop\/[^/?#]+\/?$/i]
    },
    detail: {
      nameSelectors: ['h1.product_title', 'h1'],
      priceSelectors: ['p.price', '.summary .price', '.price'],
      skuSelectors: ['.sku'],
      brandSelectors: ['.posted_in a', '.tagged_as a'],
      imageSelectors: ['.woocommerce-product-gallery img', 'img.wp-post-image'],
      structuredDataFirst: true,
      platform: 'woocommerce'
    }
  },

  casadabebida: {
    key: 'casadabebida',
    fetchMode: 'http',
    category: {
      seedUrls: [
        'https://www.casadabebida.com.br/',
        'https://www.casadabebida.com.br/whisky/',
        'https://www.casadabebida.com.br/vinho/',
        'https://www.casadabebida.com.br/licor/'
      ],
      linkSelectors: [
        'a[href^="/"][href$="/"]',
        '.item-menu a[href]',
        '#menu-categorias a[href]',
        'a.d-flex[href]'
      ],
      urlPatterns: [/https:\/\/www\.casadabebida\.com\.br\/(?!login|carrinho|checkout|meu-|novo-cadastro|sitemaps|img|includes|actions|class|templates)[a-z0-9-]+\/?$/i]
    },
    listing: {
      productCardSelectors: ['.product-thumb', '.product-thumb.col-3'],
      productLinkSelectors: [
        '.product-thumb a[href]',
        'a.product-img[href]',
        'a[href*="/"][href$="/"]'
      ],
      paginationSelectors: ['a.proxima-pagina', 'a[href*="/pagina-"]'],
      productUrlPatterns: [
        /^https:\/\/www\.casadabebida\.com\.br\/(?!login|carrinho|checkout|sitemaps|meu-|novo-cadastro)[^/?#]+\/[^/?#]+\/?$/i
      ]
    },
    detail: {
      nameSelectors: ['h1', '.product-title', '[itemprop="name"]'],
      priceSelectors: ['.price', '[itemprop="price"]'],
      skuSelectors: ['[itemprop="sku"]', '.sku'],
      imageSelectors: ['img[itemprop="image"]', '.product-image img', 'img[alt][src]'],
      structuredDataFirst: true
    }
  },

  carrefour: {
    key: 'carrefour',
    fetchMode: 'http',
    category: {
      seedUrls: [
        'https://www.carrefour.com.br/',
        'https://www.carrefour.com.br/categoria/eletrodomesticos',
        'https://www.carrefour.com.br/categoria/bebidas/destilados?count=60&sort=orders_desc'
      ],
      linkSelectors: [
        'a[href*="/categoria/"]',
        'a[href*="/colecao/"]',
        'a[href^="/categoria/"]'
      ],
      urlPatterns: [/\/categoria\//i, /\/colecao\//i]
    },
    listing: {
      productCardSelectors: [
        'a[href*="/produto/"]',
        'a[href$="/p"]',
        'a[href*="/p?"]'
      ],
      productLinkSelectors: ['a[href*="/produto/"]', 'a[href$="/p"]', 'a[href*="/p?"]'],
      paginationSelectors: ['a[href*="page="]', 'a[aria-label*="Próxima"]'],
      productUrlPatterns: [/\/produto\//i, /\/p(?:$|[/?#])/i]
    },
    detail: {
      nameSelectors: ['h1', '[data-testid*="product"] h1'],
      priceSelectors: ['[class*="price"]', '[data-testid*="price"]'],
      skuSelectors: ['[class*="sku"]'],
      imageSelectors: ['img[alt][src]'],
      structuredDataFirst: true,
      platform: 'vtex-faststore'
    }
  }
};

function getProfile(key) {
  return SITE_PROFILES[key] || null;
}

module.exports = {
  SITE_PROFILES,
  getProfile
};
