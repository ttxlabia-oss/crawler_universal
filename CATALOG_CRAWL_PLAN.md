# Catalog Crawl Plan - Five Retailers

## Objective

Build a low-setup crawler that creates and refreshes a local product database for:

- https://www.paodeacucar.com/
- https://www.atacadao.com.br/
- https://malelu.com.br/
- https://www.casadabebida.com.br/
- https://www.carrefour.com.br/

The database should represent the public product catalog visible from these sites. It should not assume sitemaps are complete or fresh. Sitemaps are useful seeds, not the source of truth.

## Core Principle

Do not rely on one discovery method.

Each site should use a hybrid discovery pipeline:

1. Sitemap discovery for initial product URL seeds.
2. Category/map-page crawling for products missing from stale sitemaps.
3. Search/category API discovery when the frontend uses public catalog APIs.
4. Product-page extraction from structured data and embedded app state.
5. Incremental refresh that revalidates known product URLs and detects vanished products.

The crawler should keep every discovery source and timestamp in the database so we can measure coverage and freshness.

## Current Code Fit

The existing repo already has useful pieces:

- `server/index.js` has an Express API and Puppeteer-based extraction.
- `server/database.js` has SQLite persistence, but the schema is too small.
- `client/src/App.tsx` has a dashboard-style UI and export flow.
- `shared/picker.js` is useful for unknown sites, but it should not be the primary path for these known retailers.

Required direction:

- Keep the visual picker as a fallback/manual debugging tool.
- Add deterministic site adapters for the five target retailers.
- Replace one-shot `/api/scrape` behavior with async catalog jobs.
- Store product URLs, product records, price/availability snapshots, crawl errors, and coverage metrics.

## Target Data

Minimum product fields:

- `retailer`
- `source_url`
- `canonical_url`
- `external_id`
- `sku`
- `name`
- `brand`
- `category_path`
- `description`
- `image_urls`
- `price`
- `list_price`
- `currency`
- `availability`
- `seller`
- `unit_size`
- `gtin_ean`
- `raw_payload`
- `first_seen_at`
- `last_seen_at`
- `last_success_at`
- `last_error_at`

Use snapshots for changing commercial data:

- price
- availability
- seller
- region/CEP/store context
- capture timestamp

Do not overwrite history when prices change.

## Database Model

Replace the current recipe-focused schema with catalog tables, or add these beside it:

### `retailers`

- `id`
- `key`
- `name`
- `base_url`
- `adapter`
- `enabled`
- `created_at`
- `updated_at`

### `discovery_sources`

- `id`
- `retailer_id`
- `type`: `sitemap`, `category_page`, `product_map`, `api`, `search`, `manual`
- `url`
- `status`
- `last_checked_at`
- `last_success_at`
- `last_error`

### `product_urls`

- `id`
- `retailer_id`
- `url`
- `canonical_url`
- `source_type`
- `source_url`
- `url_hash`
- `status`: `queued`, `active`, `gone`, `blocked`, `failed`
- `first_seen_at`
- `last_seen_at`
- `last_fetched_at`
- `failure_count`
- unique: `retailer_id + url_hash`

### `products`

- `id`
- `retailer_id`
- `canonical_url`
- `external_id`
- `sku`
- `gtin_ean`
- `name`
- `brand`
- `category_path`
- `description`
- `image_urls_json`
- `raw_static_json`
- `created_at`
- `updated_at`
- unique: `retailer_id + canonical_url`

### `product_snapshots`

- `id`
- `product_id`
- `captured_at`
- `price`
- `list_price`
- `currency`
- `availability`
- `seller`
- `region_context`
- `raw_offer_json`

### `crawl_runs`

- `id`
- `retailer_id`
- `mode`: `discover`, `extract`, `refresh`, `full`
- `status`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `started_at`
- `finished_at`
- `urls_found`
- `urls_fetched`
- `products_created`
- `products_updated`
- `errors_count`
- `notes`

### `crawl_errors`

- `id`
- `run_id`
- `retailer_id`
- `url`
- `stage`
- `error_code`
- `error_message`
- `created_at`

## Extraction Order

For every product page, extract in this order:

1. `application/ld+json` Product and Offer data.
2. Embedded frontend state, for example `__NEXT_DATA__`, VTEX/FastStore state, WooCommerce JSON, or app config scripts.
3. Public product/catalog API response if discovered from the page.
4. HTML DOM fallback selectors.
5. AI extraction fallback only for fields that are still missing, not for the whole catalog by default.

This keeps the crawler cheap, deterministic, and debuggable.

## Site Adapters

### Pao de Acucar

Known signals:

- `robots.txt` blocks `/busca`, checkout, user areas, and account paths.
- Public homepage exposes "Mapa de produtos" and "Mapa de categorias".
- Product and category availability/pricing can be regional.

Discovery strategy:

- Use product map pages as the primary seed.
- Crawl category map pages to discover category URLs.
- Crawl allowed category pages with browser/API observation to find product cards and catalog calls.
- Track CEP/store context separately; default run should collect catalog identity even when price is unavailable.

Risks:

- Product prices and stock may require region selection.
- Some endpoints may block direct HTTP clients, requiring Playwright.

### Atacadao

Known signals:

- Public sitemap index exists and includes product sitemaps.
- Site has VTEX/FastStore/Next-style signals.

Discovery strategy:

- Use product sitemaps as seed.
- Crawl category sitemap and homepage categories.
- Use category/API discovery to catch products missing from stale sitemap files.
- Extract product data from JSON-LD and embedded app state first.

Risks:

- Regional delivery/store context affects offers.
- Public site may show different product sets by CEP/store.

### Malelu

Known signals:

- WordPress/WooCommerce.
- Product URLs under `/shop/...`.
- Sitemap is useful but not trusted as complete.

Discovery strategy:

- Use sitemap as seed.
- Crawl WooCommerce category pages and pagination.
- Detect products from category listing links.
- Extract JSON-LD and WooCommerce product metadata.

Risks:

- Age gate for alcoholic products can appear in browser flow.
- Some out-of-stock products are still public and should be retained with availability state.

### Casa da Bebida

Known signals:

- Product sitemap exists at `/sitemaps/produtos.xml`.
- Sitemap includes image title/caption metadata.
- Product pages expose structured product signals.

Discovery strategy:

- Use product sitemap as seed.
- Crawl category sitemap and category pages.
- Extract product links from category pagination.
- Use sitemap image metadata as supplemental data, not authoritative product data.

Risks:

- Query parameters for filters/search are disallowed in robots; avoid filter URL expansion.

### Carrefour

Known signals:

- Very large sitemap index with many product sitemap files.
- Public product pages expose Product/Offer signals.
- Marketplace means multiple sellers, stale pages, and huge URL volume.

Discovery strategy:

- Use product sitemaps as a large seed source.
- Crawl category sitemaps and category pages for freshness checks.
- Prefer incremental crawling and sampling before full extraction.
- Store marketplace seller data in snapshots.

Risks:

- Scale is much larger than the other sites.
- Full crawl can take a long time and needs resume, rate limits, and failure tracking.

## Crawl Modes

### `discover`

Find product URLs only.

- Parse sitemaps.
- Crawl category/map pages.
- Discover public catalog API endpoints from browser network logs where allowed.
- Upsert into `product_urls`.

### `extract`

Fetch queued product URLs and parse product records.

- Use HTTP fetch first.
- Fall back to Playwright only when static fetch lacks useful data.
- Persist normalized products and snapshots.

### `refresh`

Recheck known products.

- Prioritize products seen recently.
- Recheck price/availability more often than static fields.
- Mark missing/404 products as `gone`, not deleted.

### `audit`

Measure coverage and freshness.

- Compare sitemap counts, category-discovered counts, product-map counts, and extracted product counts.
- Report duplicates, dead URLs, blocked URLs, and parsing failures.

## Low-Setup User Flow

Target command:

```bash
npm run catalog
```

Expected behavior:

1. Start the API and worker.
2. Initialize or migrate the database.
3. Run discovery for all enabled retailers.
4. Extract products with safe defaults.
5. Show progress in the web UI.
6. Export CSV/XLSX/JSON from the UI.

Optional focused commands:

```bash
npm run catalog:discover -- --site casadabebida
npm run catalog:extract -- --site casadabebida --limit 500
npm run catalog:refresh -- --site carrefour --changed-since 7d
```

## Worker Guardrails

Defaults:

- Global concurrency: 4
- Per-site concurrency: 1 or 2
- Request timeout: 30 seconds
- Retry count: 2
- Backoff: exponential with jitter
- User agent: honest browser-like crawler UA with contact string if this becomes public
- Respect `robots.txt` disallowed paths
- Never crawl checkout, login, account, cart, or payment paths
- Store raw errors and continue

Carrefour-specific defaults:

- Discovery can run fully.
- Extraction should start with sampling, for example 5,000 products, before full crawl.
- Full extraction should run resumably over many batches.

## API Additions

Add these routes to `server/index.js` or split into route modules:

- `POST /api/catalog/runs`
- `GET /api/catalog/runs`
- `GET /api/catalog/runs/:id`
- `POST /api/catalog/runs/:id/cancel`
- `GET /api/catalog/products`
- `GET /api/catalog/products/:id`
- `GET /api/catalog/export.csv`
- `GET /api/catalog/export.xlsx`
- `GET /api/catalog/coverage`

The existing `/api/scrape` can stay for manual visual-picker jobs, but catalog crawling should not depend on it.

## File Structure To Add

```text
server/
  catalog/
    adapters/
      atacadao.js
      carrefour.js
      casadabebida.js
      malelu.js
      paodeacucar.js
    discovery/
      sitemap.js
      categoryCrawler.js
      productMapCrawler.js
      apiDiscovery.js
    extraction/
      jsonLd.js
      nextData.js
      vtex.js
      woocommerce.js
      htmlFallback.js
    jobs/
      queue.js
      runner.js
      rateLimit.js
    catalogDb.js
    catalogRoutes.js
    catalogCli.js
```

## First Build Milestones

### M1 - Database and CLI skeleton

Proof:

- `npm run catalog:discover -- --site casadabebida --limit 10` creates a run and stores product URLs.

### M2 - Sitemap plus category discovery for Casa da Bebida

Proof:

- URL count from sitemap is stored.
- Category crawl discovers at least some overlapping product URLs.
- Duplicate URLs are deduped.

### M3 - Product parser using JSON-LD

Proof:

- Extract 100 Casa da Bebida products.
- Each row has name, URL, image, price or availability status, and raw JSON.

### M4 - Malelu adapter

Proof:

- Extract products from sitemap and WooCommerce category pages.
- Out-of-stock products are retained.

### M5 - Atacadao adapter

Proof:

- Extract sample of 1,000 products from sitemap/category/API discovery.
- Identify whether offer data requires CEP/store context.

### M6 - Carrefour adapter

Proof:

- Discover product URLs from sitemap plus category crawl.
- Extract a controlled sample.
- Produce coverage report before attempting full extraction.

### M7 - Pao de Acucar adapter

Proof:

- Product-map crawl creates product/category URL inventory.
- Extract product identity fields.
- Document exactly which price/availability fields need region context.

### M8 - UI dashboard

Proof:

- View crawl runs, counts, errors, and export products from the existing React app.

## Coverage Metrics

For each retailer, show:

- `sitemap_urls`
- `category_discovered_urls`
- `product_map_urls`
- `api_discovered_urls`
- `unique_product_urls`
- `successfully_extracted_products`
- `failed_urls`
- `blocked_urls`
- `gone_urls`
- `last_full_discovery_at`
- `last_extract_at`

This is how we handle untrusted sitemaps: we measure them against other discovery sources instead of blindly trusting them.

## Definition Of Done

The project is ready for the five-site goal when:

- Each retailer has a dedicated adapter.
- Discovery does not rely only on sitemaps.
- Product extraction uses structured data before DOM selectors.
- Crawls are resumable.
- Product data and price/availability snapshots are persisted.
- The UI can show progress, failures, coverage, and exports.
- A full refresh can run with one command and safe defaults.

