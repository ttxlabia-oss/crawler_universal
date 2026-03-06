# UniversalScraper Execution Plan (v2)

## 1) Direct Critique Of The Current Plan

What is good:
- Correctly identifies the core browser security constraint (same-origin policy).
- Correctly proposes injected picker + automated crawler + export.
- Correctly separates frontend, backend, and shared picker logic.

What will likely fail if followed as-is:
- It is architecture-first, not execution-first. A junior developer can read it but cannot run it step by step.
- It does not define milestones with objective pass/fail tests.
- It assumes reverse-proxy iframe is generally reliable; in practice many sites break due to CSP, dynamic JS bootstraps, anti-bot logic, cookies, and login walls.
- It treats selector capture as simple, but robust extraction needs fallback strategies (css, xpath, nearest stable parent, text anchor).
- It has no explicit data model, job state model, or error/retry model.
- It does not define guardrails (max pages, max runtime, dedupe strategy) to prevent runaway crawls.
- It does not define a vertical slice to prove value early.

Bottom line:
The old plan is a good concept note. It is not a build plan.

## 2) Outcome We Are Building

A local web app where a user can:
1. Enter a product-listing URL.
2. Visually pick product card and fields (title, price, link, image).
3. Run extraction on listing pages with pagination.
4. Preview results in a table.
5. Export CSV/XLSX.

Out of scope for v1:
- Authenticated scraping/login flows.
- Full anti-bot bypass.
- Infinite-scroll sites that require heavy custom logic.
- Distributed/cloud scraping.

## 3) Re-Scoped Architecture (Practical v1)

Use a two-mode strategy, not proxy-only:

Mode A (default): Direct automation with Playwright/Puppeteer
- Open target page in real browser context.
- Inject picker script directly via automation page context for selection step.
- Reuse captured selectors in same runtime for scraping.

Mode B (fallback): Proxy-iframe sandbox
- Keep proxy approach for sites where embedded workflow is still useful.
- Treat as fallback, not default.

Why this change:
- Proxy-only is fragile and time-expensive.
- Direct browser automation is closer to extension behavior and easier to debug.

## 4) Project Structure

- `client/` React app (wizard + preview table)
- `server/` API + scraper engine + job runner
- `shared/` picker and selector utility code shared by client/server runtime
- `data/` sqlite db and export files
- `.env` runtime config

## 5) Data Contracts (must exist before coding features)

### ScrapeRecipe
- `id`
- `name`
- `startUrl`
- `selectors`:
  - `productCard`
  - `productLink` (optional)
  - `title` (optional)
  - `price` (optional)
  - `image` (optional)
  - `nextPage` (optional)
- `fieldStrategy`: `text|attr`
- `createdAt`, `updatedAt`

### ScrapeJob
- `id`
- `recipeId`
- `status`: `queued|running|completed|failed|stopped`
- `startedAt`, `endedAt`
- `stats`: `pagesVisited`, `itemsExtracted`, `errors`
- `errorMessage`

### ScrapeRow
- `id`
- `jobId`
- `pageUrl`
- `data` (json object)
- `hash` (for dedupe)
- `createdAt`

## 6) Non-Negotiable Guardrails

- Max pages per run: default 20 (configurable).
- Max runtime per job: default 10 minutes.
- Delay/jitter between page actions: 300-1200ms.
- Deduplicate rows by stable hash (title+link or full row fallback).
- Stop if same URL repeats twice in pagination chain.
- Every job writes structured logs.

## 7) Implementation Milestones (ADHD-Friendly)

Each milestone is 1-3 hours and ends with a visible proof.
Do not start next milestone until proof passes.

### Milestone 0: Bootstrap Repo
Tasks:
- Initialize monorepo folders and scripts.
- Add `npm run dev` to start client+server.
- Add sqlite setup and migrations.

Proof:
- `npm run dev` launches client and server.
- Health endpoint returns `ok`.

### Milestone 1: Picker Prototype (single page only)
Tasks:
- Improve `shared/picker.js` to emit:
  - selector candidates (css + xpath)
  - text sample
  - attributes (`href`, `src`, `class`, `id`)
- Build minimal client panel with "Pick Product Card" and "Pick Title" buttons.

Proof:
- User clicks element and sees captured selector payload in UI JSON panel.

### Milestone 2: Recipe Save/Load
Tasks:
- Create API endpoints:
  - `POST /recipes`
  - `GET /recipes`
  - `GET /recipes/:id`
- Persist recipe in sqlite.

Proof:
- Refresh page, load saved recipe, fields repopulate.

### Milestone 3: Single-Page Extraction
Tasks:
- Build extractor for current page only.
- For each product card, resolve child fields (title/price/link/image).
- Return rows to UI preview.

Proof:
- On a test ecommerce page, extract >=10 rows with non-empty title/link in preview.

### Milestone 4: Pagination Extraction
Tasks:
- Add `nextPage` selector support.
- Crawl multiple pages with guardrails.
- Track stats in job record.

Proof:
- Extract from at least 3 pages and show page count + row count.

### Milestone 5: Export
Tasks:
- Add CSV export first.
- Add XLSX export second.

Proof:
- Exported file opens and row count matches preview.

### Milestone 6: Reliability Pass
Tasks:
- Add retries for transient navigation failures.
- Add clear error states in UI.
- Add stop/cancel job endpoint.

Proof:
- Forced failure shows actionable error and app recovers without restart.

## 8) Junior Execution Checklist (daily)

Use this strict loop daily:
1. Pick exactly one milestone task.
2. Write one failing check (manual or automated).
3. Implement smallest change.
4. Run proof test.
5. Commit with message: `M{n}: <task> passed`.
6. Update `STATUS.md` with done/next/blocker in 3 lines.

If stuck >30 minutes:
- Log blocker in `STATUS.md`.
- Create smallest reproducible case.
- Switch to next unblocked task.

## 9) Testing Strategy

Minimum tests for v1:
- Selector utility unit tests:
  - stable css generation
  - xpath fallback
- Extraction unit tests:
  - missing optional fields
  - dedupe behavior
- Integration tests:
  - run job on fixture HTML pages (static local fixtures)

Manual smoke checklist before release:
- Save recipe -> run job -> preview -> export CSV/XLSX.
- Pagination stop condition works.
- Cancel job works.

## 10) Error Taxonomy (for useful UX)

Map all failures to one of:
- `NAVIGATION_ERROR`
- `SELECTOR_NOT_FOUND`
- `PAGINATION_LOOP`
- `TIMEOUT`
- `BLOCKED_BY_SITE`
- `UNKNOWN`

UI must display:
- short human message
- technical detail (collapsible)
- suggested next action

## 11) First 2-Day Build Order

Day 1:
- Milestone 0
- Milestone 1
- Milestone 2

Day 2:
- Milestone 3
- Milestone 4 (basic)
- Milestone 5 (CSV only)

Only add XLSX and reliability after end-to-end flow works.

## 12) Definition Of Done (v1)

The project is done when:
- A user can create and save a recipe from visual selection.
- A user can run extraction across paginated listing pages.
- A user can preview results and export CSV/XLSX.
- Jobs do not run forever and failures are visible/actionable.
- At least 3 real sites (simple ecommerce layouts) pass smoke tests.

## 13) Lessons Incorporated From `Downloads/extractor`

Based on extracted extension artifacts, we explicitly include:
- Persistent local data model and job history (extension-style DB workflow).
- Visual picker payload richer than a single selector.
- Support for selector type fallback (css/xpath).
- Progress/status reporting during automation.
- Table-first data preview before export.

These are required in v1 because they are core to reliability and usability.
