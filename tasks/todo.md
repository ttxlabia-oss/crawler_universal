# Catalog Crawler Todo

## Objective

Build a repeatable, low-setup catalog crawler for Pao de Acucar, Atacadao, Malelu, Casa da Bebida, and Carrefour that exports CSVs while clearly separating live-observed product inventory from sitemap-only inventory.

## Current Stage

- [x] Added SQLite catalog tables for retailers, discovery sources, product URLs, products, snapshots, crawl runs, crawl errors, and site map nodes/edges.
- [x] Added CLI commands for discovery, extraction, export, audit, profile probing, and cartography.
- [x] Proved product-page extraction with samples from all five retailers.
- [x] Proved browser-scroll cartography for Pao de Acucar and persisted Pao product URLs from live page structure.
- [x] Persist cartography nodes/edges for all five retailers after the latest persistence changes.
- [x] Export graph CSVs for site map nodes and edges.
- [x] Split CSV/audit metrics into trusted live-observed URLs versus sitemap-only seed URLs.
- [x] Investigate Atacadao category/API discovery because category HTML exposes categories but not product links.
- [x] Run a fresh audit after changes and document exact blockers honestly.

## Acceptance Criteria

- [x] `npm run catalog:map -- --site all ...` creates `SITE_CARTOGRAPHY.md`, `SITE_CARTOGRAPHY.json`, and persisted DB graph rows for all five retailers.
- [x] `npm run catalog:export -- --site all` writes product CSVs plus trusted/live-observed CSVs where sitemap-only URLs are not presented as verified catalog completeness.
- [x] `npm run catalog:audit -- --site all` reports source trust tiers, observed category/cartography coverage, stale sitemap risk, extracted counts, failures, and queued counts.
- [x] Atacadao has either a working public listing/API discovery path or an explicit blocker note with captured evidence.

## Review

- Atacadao product listings are exposed through public GraphQL `ProductsQuery`, not product anchors in category HTML. The crawler now stores these as `api`/live-observed URLs and can extract them first with `--observed-only`.
- Carrefour still has a very large sitemap-only inventory. The truthful current metric is the observed listing subset, not the 4.5M sitemap seed count.
- Pao de Acucar category/cartography works with browser scrolling, but full detail extraction is slow because browser fallback is still needed for many pages.
- Verification run: `node --check` passed for all `server/catalog/*.js`; `npm run catalog:audit -- --site all` completed and refreshed `data/exports/AUDIT_REPORT.md`.
