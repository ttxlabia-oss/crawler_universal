# UniversalScraper Code Audit

Date: 2026-03-06
Scope: `client/`, `server/`, `shared/`, project scripts

## Critical Findings

1. Open proxy / SSRF risk in `/proxy`
- Location: `server/index.js:22-37`
- Problem: `url` is accepted from query and fetched directly by `axios.get(targetUrl)` with no protocol/domain allowlist and no private-network blocking.
- Impact: Server can be abused to access internal resources (e.g., localhost/internal IP metadata endpoints).
- Fix:
  - Parse URL with `new URL()`.
  - Allow only `http/https`.
  - Block private IP ranges and localhost.
  - Add request timeout and size limits.
  - Return sanitized error messages.

2. Browser message trust vulnerability
- Location: `client/src/App.tsx:27-39`
- Problem: `window.addEventListener('message', ...)` accepts any origin/source and immediately stores selector payload.
- Impact: Any page/frame can inject fake `ELEMENT_SELECTED` events and poison recipes.
- Fix:
  - Validate `event.origin` against the proxy origin.
  - Validate `event.source` equals the iframe contentWindow.
  - Validate payload schema before use.

## High Findings

3. Build is currently broken
- Evidence:
  - `npm.cmd run build` fails with missing module and TS errors.
  - Error includes: `Cannot find module 'lucide-react'` and unused imports.
- Location:
  - Missing dependency: `client/src/App.tsx:2`, `client/package.json`
  - Unused imports: `client/src/App.tsx:1-2`
- Impact: Frontend cannot be built for production.
- Fix:
  - Add `lucide-react` dependency.
  - Remove unused imports/variables.
  - Keep lint/build green in CI.

4. Saved recipes reload into incompatible selector shape
- Location:
  - Save shape: `client/src/App.tsx:58-62`
  - Load shape: `client/src/App.tsx:172`
  - Scrape mapping expects label keys: `client/src/App.tsx:76-79`
- Problem: Loaded recipe types become `productCard/title/...`, but scraper mapping expects `Product Card/Title/...`.
- Impact: Running scraper after loading a recipe can remap keys incorrectly and break extraction.
- Fix:
  - Use one canonical selector key schema in state and persistence.
  - Map labels only in UI rendering layer.

5. Deep selectors are collected but not persisted
- Location:
  - Client sends `detailSelectors`: `client/src/App.tsx:61`
  - DB schema lacks detail field: `server/database.js:10-16`
  - Save ignores detail selectors: `server/database.js:31-35`
- Impact: Deep scrape config is lost after save/load.
- Fix:
  - Add `detail_selectors` column/migration.
  - Persist and hydrate the same schema.

6. Extraction logic can return incorrect field values
- Location: `server/index.js:82-87`
- Problem: Field lookup falls back from `card.querySelector(selector)` to `document.querySelector(selector)`.
- Impact: Rows can reuse first global match (same title/price repeated for many cards).
- Fix:
  - Resolve fields relative to each card only.
  - Optionally support explicit global selectors via a separate strategy flag.

7. Detail page tab leak risk on exceptions
- Location: `server/index.js:103-120`
- Problem: `detailPage.close()` is only called on happy path.
- Impact: On errors, pages remain open and memory usage grows during deep scrape.
- Fix:
  - Wrap per-item detail page in `try/finally` and close in `finally`.

## Medium Findings

8. Styling system mismatch (Tailwind classes used without Tailwind setup)
- Location: `client/src/App.tsx` throughout; `client/src/index.css` has default Vite CSS only.
- Problem: Class names like `flex`, `bg-gray-50`, `text-blue-600` are utility classes requiring Tailwind, but Tailwind is not configured.
- Impact: UI will render largely unstyled or inconsistently.
- Fix:
  - Either install/configure Tailwind, or replace utility class names with actual CSS modules/styles.

9. Global CSS conflicts with intended layout
- Location:
  - `client/src/index.css:25-31` (`body` as centered flex container)
  - `client/src/App.css:1-5` (`#root` constrained to 1280px + padding)
- Impact: App cannot reliably occupy full viewport despite `h-screen` intent.
- Fix:
  - Reset base CSS for app shell (`body { display:block; min-height:100%; }`, `#root { width:100%; height:100%; max-width:none; padding:0; }`).

10. No validation/guardrails for scrape requests
- Location: `server/index.js:60-61`, `75`
- Problem: `maxPages`, selectors, and URL are minimally validated.
- Impact: Large/invalid values can cause long-running jobs or unstable behavior.
- Fix:
  - Validate request with schema (zod/joi).
  - Clamp `maxPages` to safe limits.
  - Return 400 for invalid selector payloads.

11. Database has unused `results` table and no job/result persistence flow
- Location: `server/database.js:18-25`
- Problem: Table exists but scrape endpoint returns in-memory results only.
- Impact: No history, no resumability, no audit trail despite schema intent.
- Fix:
  - Implement `jobs` + `rows` persistence used by `/api/scrape`.
  - Or remove unused table until implemented.

12. CORS policy is fully open by default
- Location: `server/index.js:13`
- Problem: `app.use(cors())` with no origin restriction.
- Impact: Increases attack surface in non-local deployment.
- Fix:
  - Restrict to configured frontend origin(s).

## Low Findings

13. Encoding/mojibake in logs/comments
- Location: multiple files (`server/index.js`, `shared/picker.js`, `server/database.js`)
- Impact: Reduced readability/maintainability.
- Fix: Save files UTF-8 cleanly or use plain ASCII.

14. Error handling can be more actionable in UI
- Location: `client/src/App.tsx:90`
- Problem: Generic `alert('Scrape failed')`.
- Impact: Harder debugging and user recovery.
- Fix: Show structured error panel from API response.

## Verification Performed

- `node --check server/index.js` -> pass
- `node --check server/database.js` -> pass
- `npm.cmd run lint` (client) -> fail (10 errors)
- `npm.cmd run build` (client) -> fail (TS + missing dependency)

## Priority Fix Order

1. Fix build blockers (`lucide-react`, unused imports/types, lint errors).
2. Fix selector schema mismatch between save/load/run paths.
3. Fix field extraction scoping (`card`-relative selectors only).
4. Add request validation and max-page guardrails.
5. Patch security issues: SSRF protections + message origin validation + restricted CORS.
6. Persist detail selectors and decide/implement job/result persistence model.
7. Resolve CSS stack (Tailwind setup or remove utility classes).

## Residual Risks / Test Gaps

- No automated tests for selector mapping, pagination behavior, or export correctness.
- No integration fixtures to confirm extractor stability across different site structures.
- No security tests for proxy endpoint abuse scenarios.
