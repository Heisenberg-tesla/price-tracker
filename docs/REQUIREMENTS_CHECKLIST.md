# Requirements Checklist

This document maps every item from the INE Software Engineer Intern Assignment brief to its implementation status.

## Core Requirements

| Status | Requirement | Implementation Details |
| :--- | :--- | :--- |
| **DONE** | Search by partial/full product name | `GET /api/store/search`, Tier 1 catalog cache, local substring match. |
| **DONE** | Track product, scrape price+stock on schedule | `POST /api/products`, scraped every 2h via cron-job.org and GitHub Actions fallback. |
| **DONE** | View price+stock history as chart or table | Recharts line chart + table toggle implemented on `/products/:id`. |
| **DONE** | Per-product scrape log with timestamp and outcome | `ScrapeLogsPanel` component showing all 5 outcomes including failures. |
| **DONE** | Scraping reliability: retries, graceful failure | 3-attempt loop, exponential backoff, pending->terminal lifecycle. |
| **DONE** | Correctness under difficulty: async content, slow/error responses | Playwright waits on selectors (not fixed sleeps), handles timeouts, and robust retries. |
| **DONE** | Honest history and logging: failures recorded not hidden | Failed/abandoned outcomes are visible in UI, and `price_history` is strictly untouched on failure. |
| **DONE** | Judgment: lightweight vs headless, free-tier scheduling | Hybrid Tier 1 (HTTP) / Tier 2 (Headless), external cron used instead of an in-process loop. |
| **DONE** | Deployment: Vercel + Render + Supabase | All three services are live and configured for production. |

## Deliverables

| Status | Deliverable | Notes |
| :--- | :--- | :--- |
| **DONE** | Live hosted site | [Frontend on Vercel](https://price-tracker-eta-self.vercel.app) |
| **DONE** | Public GitHub repo | [GitHub Repository](https://github.com/Heisenberg-tesla/price-tracker) |
| **PARTIAL** | Screen recording | Recorded normal run and `--simulate=missing` failure. `--simulate=error` has a known limitation (documented in Design Note). |
| **DONE** | README with setup, schedule, env vars | Located at repository root. |
| **DONE** | Design note | Located at `docs/DESIGN_NOTE.md`. |
| **NOT DONE** | PDF resume | To be attached separately to the submission email. |

## Bonus Items

| Status | Bonus Feature | Notes |
| :--- | :--- | :--- |
| **NOT DONE** | Price-drop/back-in-stock alerts | Skipped due to time constraints (SendGrid integration). |
| **DONE** | Multi-product dashboard | Dashboard shows all tracked products with current status. |
| **DONE** | Change detection (`structure_changed`) | Fingerprint-based detection, visible in UI as a warning badge. |
| **DONE** | Configurable scrape frequency per product | `scrapeIntervalMinutes` (5-1440 min) via `PATCH /api/products/:id`. |
| **PARTIAL** | CI/CD with GitHub Actions | Backup cron workflow exists, but full build/test/deploy CI pipeline was not implemented due to time limits. |
