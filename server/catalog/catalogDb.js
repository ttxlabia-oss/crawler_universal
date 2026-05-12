const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', '..', 'data', 'catalog.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function init() {
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA busy_timeout = 30000');
  await run('PRAGMA foreign_keys = ON');

  await run(`CREATE TABLE IF NOT EXISTS retailers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    adapter TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS discovery_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    last_checked_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    UNIQUE(retailer_id, type, url),
    FOREIGN KEY(retailer_id) REFERENCES retailers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    source_type TEXT NOT NULL,
    source_url TEXT,
    url_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_fetched_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    UNIQUE(retailer_id, url_hash),
    FOREIGN KEY(retailer_id) REFERENCES retailers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL,
    product_url_id INTEGER,
    canonical_url TEXT NOT NULL,
    external_id TEXT,
    sku TEXT,
    gtin_ean TEXT,
    name TEXT,
    brand TEXT,
    category_path TEXT,
    description TEXT,
    image_urls_json TEXT,
    raw_static_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(retailer_id, canonical_url),
    FOREIGN KEY(retailer_id) REFERENCES retailers(id),
    FOREIGN KEY(product_url_id) REFERENCES product_urls(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    price REAL,
    list_price REAL,
    currency TEXT,
    availability TEXT,
    seller TEXT,
    region_context TEXT,
    raw_offer_json TEXT,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS crawl_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    started_at TEXT,
    finished_at TEXT,
    urls_found INTEGER NOT NULL DEFAULT 0,
    urls_fetched INTEGER NOT NULL DEFAULT 0,
    products_created INTEGER NOT NULL DEFAULT 0,
    products_updated INTEGER NOT NULL DEFAULT 0,
    errors_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY(retailer_id) REFERENCES retailers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS crawl_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER,
    retailer_id INTEGER,
    url TEXT,
    stage TEXT NOT NULL,
    error_code TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES crawl_runs(id),
    FOREIGN KEY(retailer_id) REFERENCES retailers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS site_map_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    node_type TEXT NOT NULL,
    parent_url TEXT,
    depth INTEGER NOT NULL DEFAULT 0,
    category_count INTEGER NOT NULL DEFAULT 0,
    product_count INTEGER NOT NULL DEFAULT 0,
    pagination_count INTEGER NOT NULL DEFAULT 0,
    selector_hits_json TEXT,
    samples_json TEXT,
    last_mapped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(retailer_id, url),
    FOREIGN KEY(retailer_id) REFERENCES retailers(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS site_map_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer_id INTEGER NOT NULL,
    from_url TEXT NOT NULL,
    to_url TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(retailer_id, from_url, to_url, edge_type),
    FOREIGN KEY(retailer_id) REFERENCES retailers(id)
  )`);

  await run('CREATE INDEX IF NOT EXISTS idx_product_urls_retailer_status ON product_urls(retailer_id, status)');
  await run('CREATE INDEX IF NOT EXISTS idx_products_retailer ON products(retailer_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_snapshots_product_time ON product_snapshots(product_id, captured_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_site_nodes_retailer_type ON site_map_nodes(retailer_id, node_type)');
}

async function upsertRetailer(retailer) {
  await run(
    `INSERT INTO retailers (key, name, base_url, adapter, enabled, updated_at)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       name = excluded.name,
       base_url = excluded.base_url,
       adapter = excluded.adapter,
       enabled = excluded.enabled,
       updated_at = CURRENT_TIMESTAMP`,
    [retailer.key, retailer.name, retailer.baseUrl, retailer.adapter || retailer.key]
  );
  return get('SELECT * FROM retailers WHERE key = ?', [retailer.key]);
}

async function upsertDiscoverySource(retailerId, source) {
  await run(
    `INSERT INTO discovery_sources (retailer_id, type, url, status)
     VALUES (?, ?, ?, 'queued')
     ON CONFLICT(retailer_id, type, url) DO NOTHING`,
    [retailerId, source.type, source.url]
  );
}

async function updateDiscoverySource(retailerId, type, url, patch) {
  await run(
    `UPDATE discovery_sources
     SET status = COALESCE(?, status),
         last_checked_at = COALESCE(?, last_checked_at),
         last_success_at = COALESCE(?, last_success_at),
         last_error = ?
     WHERE retailer_id = ? AND type = ? AND url = ?`,
    [
      patch.status || null,
      patch.lastCheckedAt || null,
      patch.lastSuccessAt || null,
      patch.lastError || null,
      retailerId,
      type,
      url
    ]
  );
}

async function createRun(retailerId, mode, notes = '') {
  const result = await run(
    `INSERT INTO crawl_runs (retailer_id, mode, status, started_at, notes)
     VALUES (?, ?, 'running', CURRENT_TIMESTAMP, ?)`,
    [retailerId || null, mode, notes]
  );
  return result.lastID;
}

async function finishRun(runId, status, notes = null) {
  await run(
    `UPDATE crawl_runs
     SET status = ?, finished_at = CURRENT_TIMESTAMP, notes = COALESCE(?, notes)
     WHERE id = ?`,
    [status, notes, runId]
  );
}

async function incrementRun(runId, field, amount = 1) {
  const allowed = new Set(['urls_found', 'urls_fetched', 'products_created', 'products_updated', 'errors_count']);
  if (!allowed.has(field)) throw new Error(`Invalid run counter: ${field}`);
  await run(`UPDATE crawl_runs SET ${field} = ${field} + ? WHERE id = ?`, [amount, runId]);
}

async function logError(runId, retailerId, url, stage, code, message) {
  await run(
    `INSERT INTO crawl_errors (run_id, retailer_id, url, stage, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [runId || null, retailerId || null, url || null, stage, code, String(message || '').slice(0, 2000)]
  );
  if (runId) await incrementRun(runId, 'errors_count');
}

async function upsertProductUrl(retailerId, item) {
  const canonicalUrl = item.canonicalUrl || item.url;
  const urlHash = item.urlHash;
  const result = await run(
    `INSERT INTO product_urls (retailer_id, url, canonical_url, source_type, source_url, url_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')
     ON CONFLICT(retailer_id, url_hash) DO UPDATE SET
       url = excluded.url,
       canonical_url = COALESCE(excluded.canonical_url, product_urls.canonical_url),
       source_type = CASE
         WHEN product_urls.source_type = excluded.source_type THEN product_urls.source_type
         WHEN instr(',' || product_urls.source_type || ',', ',' || excluded.source_type || ',') > 0 THEN product_urls.source_type
         ELSE product_urls.source_type || ',' || excluded.source_type
       END,
       source_url = COALESCE(excluded.source_url, product_urls.source_url),
       last_seen_at = CURRENT_TIMESTAMP,
       status = CASE WHEN product_urls.status = 'gone' THEN 'queued' ELSE product_urls.status END`,
    [retailerId, item.url, canonicalUrl, item.sourceType, item.sourceUrl || null, urlHash]
  );
  return result.changes;
}

function upsertProductUrls(retailerId, items) {
  if (!items.length) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO product_urls (retailer_id, url, canonical_url, source_type, source_url, url_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')
      ON CONFLICT(retailer_id, url_hash) DO UPDATE SET
        url = excluded.url,
        canonical_url = COALESCE(excluded.canonical_url, product_urls.canonical_url),
        source_type = CASE
          WHEN product_urls.source_type = excluded.source_type THEN product_urls.source_type
          WHEN instr(',' || product_urls.source_type || ',', ',' || excluded.source_type || ',') > 0 THEN product_urls.source_type
          ELSE product_urls.source_type || ',' || excluded.source_type
        END,
        source_url = COALESCE(excluded.source_url, product_urls.source_url),
        last_seen_at = CURRENT_TIMESTAMP,
        status = CASE WHEN product_urls.status = 'gone' THEN 'queued' ELSE product_urls.status END`;

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(sql);
      for (const item of items) {
        stmt.run([
          retailerId,
          item.url,
          item.canonicalUrl || item.url,
          item.sourceType,
          item.sourceUrl || null,
          item.urlHash
        ]);
      }
      stmt.finalize((finalizeErr) => {
        if (finalizeErr) {
          db.run('ROLLBACK', () => reject(finalizeErr));
          return;
        }
        db.run('COMMIT', (commitErr) => {
          if (commitErr) reject(commitErr);
          else resolve(items.length);
        });
      });
    });
  });
}

async function getUrlsForExtraction(retailerId, limit, options = {}) {
  const limitClause = limit && limit > 0 ? 'LIMIT ?' : '';
  const params = [retailerId];
  if (limit && limit > 0) params.push(limit);
  const observedClause = options.observedOnly
    ? `AND (
        source_type LIKE '%category_page%' OR
        source_type LIKE '%cartography%' OR
        source_type LIKE '%api%' OR
        source_type LIKE '%product_map%' OR
        source_type LIKE '%manual%'
      )`
    : '';
  return all(
    `SELECT * FROM product_urls
     WHERE retailer_id = ?
       AND status IN ('queued', 'active', 'failed')
       AND (last_fetched_at IS NULL OR status != 'active')
       ${observedClause}
     ORDER BY
       CASE status WHEN 'queued' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
       CASE
         WHEN source_type LIKE '%category_page%' OR source_type LIKE '%cartography%' OR source_type LIKE '%api%' OR source_type LIKE '%product_map%' OR source_type LIKE '%manual%' THEN 0
         ELSE 1
       END,
       id ASC
     ${limitClause}`,
    params
  );
}

async function markProductUrlFetched(id, status, error = null) {
  await run(
    `UPDATE product_urls
     SET status = ?,
         last_fetched_at = CURRENT_TIMESTAMP,
         failure_count = CASE WHEN ? = 'active' THEN failure_count ELSE failure_count + 1 END,
         last_error = ?
     WHERE id = ?`,
    [status, status, error ? String(error).slice(0, 2000) : null, id]
  );
}

async function upsertProduct(retailerId, productUrlId, product) {
  const canonicalUrl = product.canonicalUrl || product.sourceUrl;
  const existing = await get(
    'SELECT id FROM products WHERE retailer_id = ? AND canonical_url = ?',
    [retailerId, canonicalUrl]
  );

  if (existing) {
    await run(
      `UPDATE products SET
        product_url_id = COALESCE(?, product_url_id),
        external_id = COALESCE(?, external_id),
        sku = COALESCE(?, sku),
        gtin_ean = COALESCE(?, gtin_ean),
        name = COALESCE(?, name),
        brand = COALESCE(?, brand),
        category_path = COALESCE(?, category_path),
        description = COALESCE(?, description),
        image_urls_json = COALESCE(?, image_urls_json),
        raw_static_json = COALESCE(?, raw_static_json),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        productUrlId,
        product.externalId || null,
        product.sku || null,
        product.gtinEan || null,
        product.name || null,
        product.brand || null,
        product.categoryPath || null,
        product.description || null,
        JSON.stringify(product.imageUrls || []),
        JSON.stringify(product.rawStatic || {}),
        existing.id
      ]
    );
    await insertSnapshot(existing.id, product);
    return { id: existing.id, created: false };
  }

  const inserted = await run(
    `INSERT INTO products (
      retailer_id, product_url_id, canonical_url, external_id, sku, gtin_ean,
      name, brand, category_path, description, image_urls_json, raw_static_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      retailerId,
      productUrlId || null,
      canonicalUrl,
      product.externalId || null,
      product.sku || null,
      product.gtinEan || null,
      product.name || null,
      product.brand || null,
      product.categoryPath || null,
      product.description || null,
      JSON.stringify(product.imageUrls || []),
      JSON.stringify(product.rawStatic || {})
    ]
  );
  await insertSnapshot(inserted.lastID, product);
  return { id: inserted.lastID, created: true };
}

async function insertSnapshot(productId, product) {
  await run(
    `INSERT INTO product_snapshots (
      product_id, price, list_price, currency, availability, seller, region_context, raw_offer_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      product.price ?? null,
      product.listPrice ?? null,
      product.currency || null,
      product.availability || null,
      product.seller || null,
      product.regionContext || null,
      JSON.stringify(product.rawOffer || {})
    ]
  );
}

async function coverage() {
  return all(`SELECT
      r.key AS retailer,
      r.name,
      (SELECT COUNT(*) FROM product_urls pu WHERE pu.retailer_id = r.id) AS unique_product_urls,
      (SELECT COUNT(*) FROM product_urls pu WHERE pu.retailer_id = r.id AND pu.status = 'queued') AS queued_urls,
      (SELECT COUNT(*) FROM product_urls pu WHERE pu.retailer_id = r.id AND pu.status = 'active') AS active_urls,
      (SELECT COUNT(*) FROM product_urls pu WHERE pu.retailer_id = r.id AND pu.status = 'failed') AS failed_urls,
      (SELECT COUNT(*) FROM product_urls pu WHERE pu.retailer_id = r.id AND pu.status = 'blocked') AS blocked_urls,
      (SELECT COUNT(*) FROM products p WHERE p.retailer_id = r.id) AS products,
      (SELECT COUNT(*) FROM product_snapshots ps JOIN products p ON p.id = ps.product_id WHERE p.retailer_id = r.id) AS snapshots,
      (SELECT MAX(pu.last_seen_at) FROM product_urls pu WHERE pu.retailer_id = r.id) AS last_seen_at,
      (SELECT MAX(pu.last_fetched_at) FROM product_urls pu WHERE pu.retailer_id = r.id) AS last_fetched_at
    FROM retailers r
    ORDER BY r.key`);
}

async function sourceBreakdown() {
  return all(`SELECT
      r.key AS retailer,
      pu.source_type,
      COUNT(*) AS urls
    FROM product_urls pu
    JOIN retailers r ON r.id = pu.retailer_id
    GROUP BY r.key, pu.source_type
    ORDER BY r.key, urls DESC`);
}

async function upsertSiteMapNode(retailerId, node) {
  await run(
    `INSERT INTO site_map_nodes (
      retailer_id, url, node_type, parent_url, depth, category_count, product_count,
      pagination_count, selector_hits_json, samples_json, last_mapped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(retailer_id, url) DO UPDATE SET
      node_type = excluded.node_type,
      parent_url = COALESCE(excluded.parent_url, site_map_nodes.parent_url),
      depth = excluded.depth,
      category_count = excluded.category_count,
      product_count = excluded.product_count,
      pagination_count = excluded.pagination_count,
      selector_hits_json = excluded.selector_hits_json,
      samples_json = excluded.samples_json,
      last_mapped_at = CURRENT_TIMESTAMP`,
    [
      retailerId,
      node.url,
      node.nodeType,
      node.parentUrl || null,
      node.depth || 0,
      node.categoryCount || 0,
      node.productCount || 0,
      node.paginationCount || 0,
      JSON.stringify(node.selectorHits || {}),
      JSON.stringify(node.samples || {})
    ]
  );
}

async function upsertSiteMapEdge(retailerId, edge) {
  await run(
    `INSERT INTO site_map_edges (retailer_id, from_url, to_url, edge_type)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(retailer_id, from_url, to_url, edge_type) DO UPDATE SET
       last_seen_at = CURRENT_TIMESTAMP`,
    [retailerId, edge.fromUrl, edge.toUrl, edge.edgeType]
  );
}

async function siteMapSummary() {
  return all(`SELECT
      r.key AS retailer,
      n.node_type,
      COUNT(*) AS nodes,
      SUM(n.category_count) AS category_links_seen,
      SUM(n.product_count) AS product_links_seen,
      SUM(n.pagination_count) AS pagination_links_seen
    FROM site_map_nodes n
    JOIN retailers r ON r.id = n.retailer_id
    GROUP BY r.key, n.node_type
    ORDER BY r.key, n.node_type`);
}

module.exports = {
  init,
  upsertRetailer,
  upsertDiscoverySource,
  updateDiscoverySource,
  createRun,
  finishRun,
  incrementRun,
  logError,
  upsertProductUrl,
  upsertProductUrls,
  getUrlsForExtraction,
  markProductUrlFetched,
  upsertProduct,
  coverage,
  sourceBreakdown,
  upsertSiteMapNode,
  upsertSiteMapEdge,
  siteMapSummary,
  all,
  get,
  run
};
