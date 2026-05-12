# Catalog Crawl Audit

Generated: 2026-05-12T16:47:40.946Z

## Coverage

| retailer | unique_product_urls | products | snapshots | queued_urls | active_urls | failed_urls | blocked_urls | last_fetched_at |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| atacadao | 54582 | 446 | 485 | 54135 | 446 | 1 | 0 | 2026-05-12 16:41:57 |
| carrefour | 4505321 | 193 | 193 | 4505121 | 193 | 7 | 0 | 2026-05-12 14:57:10 |
| casadabebida | 6949 | 1000 | 1000 | 5949 | 1000 | 0 | 0 | 2026-05-12 14:03:48 |
| malelu | 1208 | 296 | 296 | 908 | 296 | 4 | 0 | 2026-05-12 14:44:22 |
| paodeacucar | 3209 | 104 | 104 | 3105 | 104 | 0 | 0 | 2026-05-12 15:33:33 |

## Source Breakdown

| retailer | source_type | urls |
|---|---|---:|
| atacadao | sitemap | 54335 |
| atacadao | api | 247 |
| carrefour | sitemap | 4504626 |
| carrefour | category_page,cartography | 494 |
| carrefour | cartography | 196 |
| carrefour | category_page | 5 |
| casadabebida | sitemap | 3734 |
| casadabebida | category_page | 1718 |
| casadabebida | sitemap,category_page,cartography | 488 |
| casadabebida | category_page,cartography | 478 |
| casadabebida | cartography | 261 |
| casadabebida | sitemap,cartography | 189 |
| casadabebida | sitemap,category_page | 81 |
| malelu | sitemap | 983 |
| malelu | category_page,cartography | 107 |
| malelu | sitemap,category_page,cartography | 99 |
| malelu | cartography | 9 |
| malelu | category_page | 7 |
| malelu | sitemap,category_page | 2 |
| malelu | sitemap,cartography | 1 |
| paodeacucar | cartography | 3205 |
| paodeacucar | category_page,cartography | 4 |

## Source Trust

| retailer | source_trust | urls | extracted_products | active_urls | queued_urls | failed_urls |
|---|---|---:|---:|---:|---:|---:|
| atacadao | sitemap_only_unverified | 54335 | 199 | 199 | 54135 | 1 |
| atacadao | observed_listing | 247 | 247 | 247 | 0 | 0 |
| carrefour | sitemap_only_unverified | 4504626 | 193 | 193 | 4504426 | 7 |
| carrefour | observed_listing | 695 | 0 | 0 | 695 | 0 |
| casadabebida | sitemap_only_unverified | 3734 | 689 | 689 | 3045 | 0 |
| casadabebida | observed_listing | 2457 | 0 | 0 | 2457 | 0 |
| casadabebida | observed_plus_sitemap | 758 | 311 | 311 | 447 | 0 |
| malelu | sitemap_only_unverified | 983 | 286 | 286 | 693 | 4 |
| malelu | observed_listing | 123 | 0 | 0 | 123 | 0 |
| malelu | observed_plus_sitemap | 102 | 10 | 10 | 92 | 0 |
| paodeacucar | observed_listing | 3209 | 104 | 104 | 3105 | 0 |

## Site Map Graph

| retailer | node_type | nodes | category_links_seen | product_links_seen | pagination_links_seen |
|---|---|---:|---:|---:|---:|
| atacadao | category | 59 | 27260 | 160 | 0 |
| atacadao | root | 2 | 931 | 0 | 0 |
| carrefour | category | 52 | 778 | 989 | 0 |
| carrefour | root | 1 | 42 | 1 | 0 |
| casadabebida | category | 59 | 63777 | 4677 | 50 |
| casadabebida | root | 4 | 4327 | 367 | 12 |
| malelu | category | 49 | 2083 | 517 | 24 |
| malelu | root | 2 | 86 | 28 | 6 |
| paodeacucar | category | 60 | 1680 | 3065 | 64 |
| paodeacucar | root | 4 | 721 | 94 | 6 |

## Audit Notes

- Sitemaps are treated as seeds, not proof of completeness.
- Completeness is assessed by comparing sitemap, category/page, and extraction counts.
- Rows with `url_status=queued` were discovered but not extracted yet.
- Rows with `source_trust=sitemap_only_unverified` are sitemap seeds that still need live listing/API confirmation or product-page extraction.
- Rows with `source_trust=observed_listing` or `observed_plus_sitemap` were seen through category/cartography/API/manual discovery and are more reliable than sitemap-only rows.
- Rows with `url_status=blocked` or `failed` need retry, browser fallback, region context, or adapter work.
- Pao de Acucar and grocery offers may require CEP/store context for complete price/stock data.
- Carrefour is a very large marketplace catalog; full extraction requires long resumable batches.