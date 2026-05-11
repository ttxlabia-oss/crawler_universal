# UniversalScraper — Session Context & Handoff

> **Purpose:** This document exists so you can pick this project up on a new machine or with a different AI with full context. Read this first.

---

## 1. What This Project Is

**UniversalScraper** is a local web app that lets a user:
1. Enter a product-listing URL from any marketplace
2. Visually pick product cards and fields (title, price, link, image) using a browser-injected picker
3. Run extraction across paginated pages with guardrails
4. Preview results in a table
5. Export to CSV/XLSX

It is a **two-mode scraper**: direct Playwright/Puppeteer automation (default) + proxy-iframe sandbox (fallback).

**GitHub:** https://github.com/ttxlabia-oss/crawler_universal

---

## 2. Project History & Session Log

### Background — The Crawler Lineage (Oct–Dec 2025)

Before this repo existed, the user ran a series of Codex sessions on two related projects:

**`C:\Users\adria\OneDrive\Documents\projetometa\Crowler_Sites`** (Oct 2025)
- Early marketplace crawler with versioned scripts: `extract_links.py`, `extract_details.py`, `extract_price.py`, `app.py`
- Targeted Brazilian e-commerce sites (lojas, matconcasa, etc.)
- Codex session: `2025-10-22` — asked how to use external APIs/structures to make the crawler faster and more functional

**`C:\Users\adria\OneDrive\Documents\extrator_cloud`** (Nov–Dec 2025)
- More mature "universal extractor" project (Python/FastAPI), cloud-deployable
- Aimed at any marketplace: Mercado Livre, Shopee, Magalu, C&A, Amazon BR, etc.
- Had n8n integration, Playwright renderer support, site-specific profiles
- Multiple Codex sessions worked through: architecture critique, beta readiness, VTEX API integration, category extraction, streaming extraction, platform-specific parsers
- Reached version 0.32 with known gaps before this repo was started

### The Merger Session — March 6, 2026

**Codex session ID:** `019cc361-6351-7540-b695-edcc107bb5e0`
**Date:** 2026-03-06 (morning)
**Working dir:** `C:\Users\adria`

The user asked Codex to:
1. Read `Documents/universalscraper/` — the crawler project at the time
2. Read `Downloads/extractor/` — a downloaded Chrome extension ("Ultimate Web Scraper" v6.0.0)
3. Criticize the existing plan and rewrite it so a junior developer with ADHD can execute it
4. Audit the code and write findings to a file

**What Codex produced:**
- Rewrote the plan → `PLAN.md` (see Section 4)
- Audited the code → `AUDIT.md` (see Section 5)
- Deployed to Vercel (had issues: 404, iframe self-recursion)
- Pushed to GitHub: `https://github.com/ttxlabia-oss/crawler_universal`

**Commits made in that session:**
```
0bb8b9ec  Initial commit: UniversalScraper with Visual Picker, Puppeteer Engine, and Audited Security
5cae2c42  Fix local startup and Vercel routing/build configuration
54afbdb4  Fix Vercel build: Tailwind v4 PostCSS configuration
fa4f6c8b  Prevent iframe self-recursion and require production API base URL
```

**Issues hit during session:**
- `localhost refused to connect` — server not starting correctly
- Vercel 404 after deploy — routing/build config needed fixes
- Iframe showing crawler-inside-crawler — proxy mode was loading the app URL recursively

---

## 3. The Chrome Extension That Was Studied

**Name:** Ultimate Web Scraper  
**Version:** 6.0.0  
**Source:** Downloaded from Chrome Web Store, extracted to `C:\Users\adria\Downloads\extractor\`  
**File:** `Ultimate-Web-Scraper-Chrome-Web-Store.zip`

### How the Extension Works

The extension uses **Manifest V3** with a Side Panel UI.

| File | Role |
|---|---|
| `manifest.json` | Declares permissions: `activeTab`, `scripting`, `storage`, `sidePanel` |
| `background.bundle.js` | Service worker — initializes DB (IndexedDB/chrome.storage), manages messaging |
| `sidepanel.html/js` | Primary UI — persistent side panel alongside browser |
| `pageElementPicker.bundle.js` | Injected into pages — overlays highlight on DOM, captures element metadata on click |
| `table.html/js` | Data management view — filter, preview "Collections", export |
| `_locales/` | i18n support for many languages |

### How Picking Works
1. User clicks "Pick" in side panel
2. Extension calls `chrome.scripting.executeScript` to inject `pageElementPicker`
3. Script overlays hover highlight on DOM as user moves mouse
4. Click captures: text, href, src, CSS selectors, XPath
5. Data sent via `chrome.runtime.sendMessage` back to side panel
6. Stored in local DB; viewable in `table.html`

### Key Lessons Extracted (incorporated into PLAN.md)
- Persistent local data model and job history
- Visual picker emits richer payload than a single selector (css + xpath + attributes)
- Selector type fallback: css → xpath → text anchor
- Progress/status reporting during automation
- Table-first data preview before export
- Collections/history model (not just one-off runs)

### Why This Matters for UniversalScraper
The Chrome extension proves the UX pattern works. UniversalScraper replicates the same flow but:
- Without needing a Chrome extension install
- Using server-side Playwright/Puppeteer instead of `chrome.scripting`
- Targeting marketplaces specifically with pagination support

---

## 4. The Plan (Summary)

Full plan is in `PLAN.md`. Key points:

**Outcome:** Local web app — pick → scrape → preview → export

**Architecture:**
- `client/` — React (wizard + preview table)
- `server/` — Express API + Puppeteer engine + job runner
- `shared/` — picker script shared by client and server
- `data/` — SQLite DB + export files

**Data models:** `ScrapeRecipe`, `ScrapeJob`, `ScrapeRow`

**Guardrails:** max 20 pages, max 10 min runtime, 300-1200ms jitter, dedup by hash

**Milestones (ADHD-friendly, 1-3h each):**
- M0: Bootstrap (npm run dev works, health endpoint)
- M1: Picker prototype (element click → selector payload in UI)
- M2: Recipe save/load (POST/GET /recipes → sqlite)
- M3: Single-page extraction (≥10 rows with title+link)
- M4: Pagination (≥3 pages, guardrails)
- M5: Export (CSV then XLSX)
- M6: Reliability pass (retries, error states, cancel)

---

## 5. Audit Findings Summary

Full audit is in `AUDIT.md`. Priority order:

**Must fix before any real use:**
1. Build broken — `lucide-react` missing, TS lint errors in `client/`
2. Selector schema mismatch — save uses `productCard` keys, scraper expects `Product Card` labels
3. Field extraction scoping — resolver falls back to global `document.querySelector`, returning wrong data
4. SSRF risk in `/proxy` — any URL fetched with no allowlist or private-IP blocking
5. Message origin not validated — any frame can inject fake `ELEMENT_SELECTED` events

**High priority:**
6. Detail selectors not persisted — DB schema missing `detail_selectors` column
7. Detail page tab leak — `detailPage.close()` not called in `finally` block
8. No request validation or max-page guardrails on `/api/scrape`

**Medium:**
9. Tailwind not configured — UI renders unstyled
10. CORS fully open (`cors()` with no origin restriction)
11. `results` table in DB never written to

**Current state:** 4 commits in, build was getting fixed. Vercel deployment was attempted but had routing issues. Core scraping logic exists but has the bugs listed above.

---

## 6. Current Project Structure

```
UniversalScraper/
├── client/          React app (Vite + TypeScript + Tailwind)
│   └── src/App.tsx  Main UI: wizard + picker iframe + preview table
├── server/
│   ├── index.js     Express API: /proxy, /api/scrape, /api/recipes
│   └── database.js  SQLite setup (better-sqlite3)
├── shared/
│   └── picker.js    Injected into pages for element selection
├── data/            SQLite DB and exports (runtime, gitignored)
├── PLAN.md          Full execution plan
├── AUDIT.md         Code audit findings
├── vercel.json      Vercel routing config
└── package.json     Root: concurrently runs client + server
```

---

## 7. Related Projects (for additional context)

| Project | Location | Notes |
|---|---|---|
| extrator_cloud | `C:\Users\adria\OneDrive\Documents\extrator_cloud\` | Python/FastAPI universal extractor, v0.32, cloud-deployable, n8n integration. More mature but different tech stack. |
| Crowler_Sites | `C:\Users\adria\OneDrive\Documents\projetometa\Crowler_Sites\` | Original Python crawler scripts, per-site extractors |
| Ultimate Web Scraper ext | `C:\Users\adria\Downloads\extractor\` | Chrome extension source — studied for UX patterns |

---

## 8. Where to Pick Up

**Immediate priorities (in order):**

1. Fix the build
   ```bash
   cd client && npm install lucide-react
   npm run lint -- --fix
   npm run build
   ```

2. Fix selector key schema — standardize on camelCase keys (`productCard`, `title`, `price`) everywhere: save, load, scrape

3. Fix field extraction — resolver in `server/index.js:82-87` must be card-relative only

4. Add validation on `/api/scrape` — clamp maxPages, validate selector presence

5. Fix SSRF — add URL allowlist/private-IP blocklist in `/proxy`

6. Wire Playwright properly — current server uses Puppeteer, confirm it's installed and launching headless correctly

**Then run smoke test:**
- Start: `npm run dev`
- Open app, enter any product listing URL
- Pick product card → save recipe → run scrape → preview → export CSV

---

## 9. Tooling Notes

- **Runtime:** Node.js, Express, better-sqlite3, Puppeteer
- **Frontend:** React + Vite + TypeScript + Tailwind v4
- **Deployment:** Vercel (had issues — see commit history), can also run locally
- **AI sessions used:** Codex (GPT-5) via VS Code extension and CLI
- **Language note:** User (Adrian) communicates in Portuguese (BR) and English

---

*Last updated: 2026-05-11. Generated from session history in `~/.codex/sessions/` and `~/.claude/sessions/`.*
