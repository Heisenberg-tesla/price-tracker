# Design Note

This document outlines the design decisions, trade-offs, limitations, and key learnings from building the full-stack product price tracker.

## How Reliability Was Achieved

*   **Mandatory Headless Browser (Tier 2):** The mock store employs several defense mechanisms to prevent simple HTTP scraping: a PoW/WASM challenge, XOR-encrypted price payloads, hover dwell requirements (>= 600ms), a minimum of 8 mouse moves, and trusted click validation. Pure HTTP scraping is impossible for price extraction. Playwright is strictly required for this task.
*   **Lightweight Catalog Fetching (Tier 1):** The `/api/catalog` endpoint is unauthenticated and returns product metadata without prices. Catalog searches rely exclusively on lightweight HTTP requests, reducing unnecessary browser overhead.
*   **Honeypot Defense:** The store includes hidden sibling elements containing fake prices (e.g., `.price-value` and `[data-price="true"].amount`, both with `aria-hidden="true"`). The extraction logic explicitly filters out elements with `aria-hidden` attributes to avoid extracting honeypot values.
*   **Zero-Width Space Handling:** The price text is maliciously split across multiple child `span` elements, sometimes injected with zero-width spaces (`\u200B`). The scraper concatenates the full `.textContent` of the carrier element and sanitises it before parsing.
*   **Robust Price Normalisation:** The normalisation logic successfully handles 4 distinct observed price formats:
    *   Plain (e.g., `₹17,263`)
    *   European (e.g., `17.967,00`)
    *   Tax-suffix (e.g., `₹14,177/- incl. taxes`)
    *   Fullwidth Unicode digits (e.g., `₹１２,６１６` from the store's 'unicode' format mode)
*   **Crash-Safe Scrape Logging:** A `scrape_logs` row is created with an outcome of `pending` *before* scraping starts. If the scraper crashes or the process exits unexpectedly, evidence of the attempt remains. The `reconcileStalePendingLogs()` function sweeps orphaned `pending` rows to an `abandoned` state on server boot and at the start of every cron execution.
*   **Strict Price History Writes:** The `price_history` table is written to *only* upon a validated, successful scrape. Failed scrapes log their failure but never insert invalid data into the history.
*   **Concurrency Control:** A database-level unique partial index enforces that only a single `pending` scrape can exist per product, and ensures only a single cron job runs at a time.
*   **Retry Mechanisms:** The scraper implements an exponential backoff strategy with jitter between retry attempts (up to 3 maximum attempts).
*   **Granular Logging:** Per-attempt logging details are captured and stored in the `attempt_details` `jsonb` column for deep debugging capabilities.

## Trade-offs Made

*   **Mandatory headless browser for ALL price scrapes vs HTTP-only:** Using a headless browser is significantly slower and consumes more memory. However, given the store's challenge/session/encrypt stack, there was no real choice here; headless is the only viable approach for price extraction.
*   **External cron (cron-job.org) vs in-process `setInterval`:** Render's free tier sleeps after 15 minutes of inactivity, rendering in-process loops unreliable for long-term scheduling. An external ping ensures the service wakes up and processes the queue.
*   **GitHub Actions as a backup scheduler:** GitHub Actions scheduled runs are best-effort, subject to queue delays, and are automatically disabled after 60 days of repository inactivity. It serves as a reliable secondary backup, but not the primary driver.
*   **Integer cents (`bigint`) vs `decimal` for money:** Storing prices as integer cents eliminates floating-point arithmetic errors entirely, a standard best practice for financial data.
*   **In-memory Catalog Caching (10 min TTL) vs per-request fetch:** To provide a snappy search experience and avoid hammering the store's `/api/catalog` endpoint on every keystroke, the catalog is cached in memory.

## What Was Deliberately NOT Built (Time Constraints)

*   **Email Alerts:** Sending notifications via SendGrid on price drops or restocks was skipped due to time limits (bonus requirement).
*   **Full CI/CD Pipeline:** While a backup cron workflow exists, a full GitHub Actions pipeline for building, testing, and deploying on every push was not implemented (bonus requirement).
*   **`--simulate=error` Headed Mode Limitation:** The headed simulation mode for errors is partially broken. The mock store's internal 6-retry loop on its price endpoint, combined with Playwright's route interception, causes the browser context to close unexpectedly before the orchestrator's `finally` block can execute. This is root-caused to a timing interaction between the store's client-side retry storm and the interception lifecycle. This is a known limitation and is not hidden.

## What AI Got Wrong on First Attempt (And How It Was Corrected)

These are real examples of implementation missteps corrected during development:

1.  **`scrape_logs.outcome` CHECK Constraint:**
    *   *Initial:* Allowed only `('success', 'success_after_retry', 'failed')`.
    *   *Correction:* Missing `pending` and `abandoned`, which are critical for the crash-safe logging strategy. Fixed before any data was written to the database.
2.  **`price_history` CHECK Constraint:**
    *   *Initial:* Allowed `price_cents >= 0` (permitting zero).
    *   *Correction:* Tightened to `> 0` to ensure a failed regex parse that incorrectly returns `0` can never be stored as a valid price.
3.  **Structural Fingerprint Brittleness:**
    *   *Initial:* Hashed the literal child span COUNT (e.g., `spans(7)` vs `spans(9)`). The store splits each digit into a separate span, so any normal price change triggered a false "structure changed" alarm.
    *   *Correction:* Fixed to hash the *presence* of split-spans (a boolean) rather than the absolute digit count.
4.  **Error Reclassification Overreach:**
    *   *Initial:* Overwrote *any* failure type with `structure_changed` whenever a fingerprint delta coincided, including unrelated validation errors (like a deliberate product name mismatch).
    *   *Correction:* Fixed to only reclassify causally-connected extraction failures (e.g., `NO_PRICE_CARRIER`, `DOM_ERROR`).
5.  **Browser Teardown Bug:**
    *   *Initial:* Closing the context/browser without explicitly closing the page first left in-flight CDP operations (`goto`, `waitForTimeout`) that Playwright aborted mid-run. This caused every retry after attempt 1 to fail with "Target page, context or browser has been closed".
    *   *Correction:* Fixed with an explicit `page -> context -> browser` teardown ordering placed inside a `finally` block.
6.  **`CRON_SECRET` Default Value:**
    *   *Initial:* The Zod schema provided a default value (`dev-cron-secret`). A secret with a public fallback defeats its entire purpose.
    *   *Correction:* Fixed to `z.string().min(16)` with *no* default. The app now crashes loudly at boot if the secret is missing.
7.  **`p-limit` Compatibility:**
    *   *Initial:* The `p-limit` package (ESM-only) was incompatible with the CommonJS Express backend running under TypeScript's Node16 `moduleResolution`.
    *   *Correction:* Replaced entirely with a native, inline concurrency limiter (`src/lib/concurrencyLimit.ts`).
8.  **`moduleResolution` Configuration:**
    *   *Initial:* `moduleResolution: "Node"` in `tsconfig.json` was interpreted as the removed `node10` alias by TypeScript 5.7+ on Render.
    *   *Correction:* Fixed by changing to `Node16` (along with a matching `"module": "Node16"`).
