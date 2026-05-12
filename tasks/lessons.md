# Lessons

- Use `login:false` for PowerShell commands in this workspace; login shell startup has repeatedly caused apparent hangs.
- Long crawler commands should be bounded by site, category count, API pages, and export behavior. Use `--no-export` during extraction batches and run export separately.
- Never treat sitemap-only URLs as complete catalog truth. Report `source_trust` and keep live-observed listing/API/cartography URLs separate from sitemap seeds.
- When category HTML has no product anchors, inspect rendered browser network calls before tuning selectors. Atacadao uses public GraphQL `ProductsQuery` for listings.
