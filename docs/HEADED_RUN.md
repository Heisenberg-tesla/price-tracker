# Observable Headed-Mode Scraper & Failure Simulation Guide

This document describes the observable headed-mode execution system implemented in the Price Tracker, how to run and configure it, the failure simulation engine, and a recommended 3-minute recording script for assignment evaluation.

---

## 1. Overview & Architecture

The observable headed scraper runs Playwright Chromium with `headless: false` in a visible 1280×800 window with configurable pacing, live human-readable terminal narration, and an in-browser floating HUD overlay.

### Key Capabilities

1. **Full Orchestrator Execution**:
   - The script does **not** shortcut or mock the workflow. It executes through the **real** orchestrator (`backend/src/scraper/scrapeProduct.ts`).
   - Generates genuine `pending` rows in `scrape_logs`, executes realistic mouse hover & dwell sequences, passes through strict validation gates (`validateScrapeResult`), writes to `price_history` only upon validated success, and finalises `scrape_logs` in the database.
2. **Observable Browser HUD Banner**:
   - Injected directly into the DOM via `page.evaluate` (`#price-tracker-hud-banner`).
   - Displays real-time status: `Attempt X/Y`, current sub-step (e.g. *"Page loaded"*, *"Simulating mouse trajectory & dwell"*, *"Dwell satisfied (600ms+). Clicking Reveal..."*, *"Extracted: ₹1,29,900.00"*).
   - In headed mode, introduces a deliberate 1.2-second observation pause upon attempt completion/failure so video viewers can see the final state before context teardown.
3. **Colour-Coded Terminal Narration**:
   - Clearly narrates every step: strategy (`headless` Chromium), target selector paths (`.price-main child spans`), extracted values, timing per phase (`Page navigation: 142ms`, `Dwell: 650ms`), and countdowns for backoff intervals.
4. **Live In-Place Retry Backoff Countdown**:
   - As backoff pauses between retries (e.g. `2.3s`), terminal updates dynamically in-place:
     ```text
     ⏳ Backing off 2.1s before retry (total: 2.5s)...
     ```
5. **Honest Failure Simulation Engine**:
   - Exercises real retry, classification, and database logging paths on demand via `--simulate=<mode>`.
   - When active, the HUD banner and terminal prominently display:
     ```text
     ⚠️ SIMULATION ACTIVE: [MODE] (Staged fault injection)
     ```
     This ensures total transparency in video recordings between genuine organic runs and staged fault demonstrations.

---

## 2. Command Reference

All commands are run from the `backend/` directory using the `scrape:headed` script:

```bash
cd backend
npm run scrape:headed -- [options]
```

### Scenario 1: Normal Successful Headed Run (Default)

Executes a live organic scrape against the specified product ID or URL.

```bash
npm run scrape:headed -- --product=915
```

Or using a full product URL:

```bash
npm run scrape:headed -- --product="https://demo.inelabteamdev.com/product/915"
```

**Expected Outcome**:
- Attempt 1 succeeds in ~15–20s.
- Shows mouse movement across the price container, 650ms dwell satisfying the hover threshold, trusted click on `Reveal price`, and terminal green HUD banner displaying extracted price.
- Final outcome: `SUCCESS` (attempts: 1).
- Inserts a genuine row into `price_history` and finalises `scrape_logs` with status 200.

---

### Scenario 2: Slow Response Simulation (`--simulate=slow`)

Simulates a delayed upstream challenge/session/price response on Attempt 1 that exceeds the 15-second page timeout, forcing the retry loop to trigger. Attempt 2 executes normally and recovers.

```bash
npm run scrape:headed -- --product=915 --simulate=slow
```

**Expected Outcome**:
- **Attempt 1**: Route interception delays `/api/products/*/price` by 16s. The product page and title render normally; the delay only kicks in when the reveal button is clicked and the frontend calls the price API. The dwell sequence completes, but then the price API call hangs until the 15s click-retry timeout expires. Classified as `timeout`. Banner turns red: `Failed: ...`.
- **Terminal**: Counts down exponential backoff:
  ```text
  ⏳ Backing off 2.2s before retry (total: 2.5s)...
  ✔ Backoff complete. Launching next attempt...
  ```
- **Attempt 2**: Launches a fresh browser session with zero route interception, loads cleanly, satisfies dwell, clicks reveal, and successfully extracts price.
- Final outcome: `SUCCESS_AFTER_RETRY` (attempts: 2).
- Inserts price history row with `scrape_run_id` pointing to the log.

---

### Scenario 3: Error Simulation (`--simulate=error`)

Simulates HTTP 500 server errors on Attempts 1 and 2 by intercepting product API calls with HTTP 500.

```bash
npm run scrape:headed -- --product=915 --simulate=error
```

**Expected Outcome**:
- **Attempt 1**: Page and product title load normally. Mouse hover/dwell sequence completes as usual. When the reveal button is clicked and the frontend calls `/api/products/*/price`, the interceptor returns HTTP 500. The price container enters `.price-error` state. Classified as `http_error`. Backoff countdown begins.
- **Attempt 2**: Same — fresh browser, page loads normally, dwell satisfies, click triggers the same interceptor, HTTP 500 returned. Second backoff countdown begins.
- **Attempt 3**: Interception is NOT set up (the condition `attempt === 1 || attempt === 2` is false). Attempt 3 runs as a completely clean, uninterrupted scrape with zero route handlers active. The price-reveal API returns its real response and the scrape recovers (`success_after_retry`).

> [!NOTE]
> The key difference from the previous implementation: the page, title, and DOM render **normally** on attempts 1 and 2. The injected fault only fires when the price-reveal API is called — producing a precise "price service down" demo rather than a "whole page down" demo.

*(Note: To test total exhaustion with error simulation, specify `--attempts=2`: `npm run scrape:headed -- --product=915 --simulate=error --attempts=2`)*.

---

### Scenario 4: Missing Price Element Simulation (`--simulate=missing`)

Simulates a severe DOM regression where the non-honeypot price carrier element is stripped from `.price-main` right after extraction begins, leaving only honeypots or nothing.

```bash
npm run scrape:headed -- --product=915 --simulate=missing
```

**Expected Outcome**:
- **Attempt 1**: Price reveals, extraction begins. Carrier element is stripped from DOM. Scraper detects visible elements are empty or honeypots only. Throws `NO_PRICE_CARRIER` (classified as `parse_error`).
- **Attempts 2 & 3**: Retries with backoff, encountering the same missing carrier state on each attempt.
- Final outcome: `FAILED` (attempts: 3/3).
- **Honest Verification**:
  - `scrape_logs` row recorded with `outcome='failed'`, `error_type='parse_error'`, and detailed attempt details.
  - **Zero rows written to `price_history`**, verifying defense-in-depth data integrity.

---

### Optional Configuration Flags

| Flag | Description | Default |
|---|---|---|
| `--product=<id\|url>` | Store product ID, tracked UUID, or complete product URL | `915` |
| `--simulate=<mode>` | Failure mode: `none`, `slow`, `error`, `missing` | `none` |
| `--slowmo=<ms>` | Playwright slow-motion delay in milliseconds between actions | `75` |
| `--devtools` | Automatically opens Chromium Developer Tools window | `false` |
| `--attempts=<n>` | Maximum scrape attempts before terminating | `3` |

Example with custom slow-mo and DevTools:
```bash
npm run scrape:headed -- --product=915 --slowmo=100 --devtools
```

---

## 3. Suggested 3-Minute Screen Recording Script / Shot List

This script is timed for a concise, high-impact demonstration (~3 minutes total) suitable for evaluation and assignment submission.

| Timecode | Scene / Action | Screen Setup | Narration / Voiceover Points |
|---|---|---|---|
| **0:00 – 0:25**<br>*(~25s)* | **Scene 1: Normal Headed Scrape Run**<br><br>Command:<br>`npm run scrape:headed -- --product=915`<br><br>Action: Split screen showing terminal on the left, Playwright browser on the right. | Terminal + Browser side-by-side | *"Here is the observable headed run in Playwright Chromium. Watch the in-browser HUD banner at the top displaying 'Attempt 1/3'. You can see realistic mouse trajectory across the price area, satisfying the 600ms hover dwell. The reveal button unlocks and is clicked with trusted events. The price is revealed, honeypots are safely skipped, and the terminal logs a successful extraction of ₹1,29,900.00."* |
| **0:25 – 1:15**<br>*(~50s)* | **Scene 2: Slow Response Simulation & Retry Recovery**<br><br>Command:<br>`npm run scrape:headed -- --product=915 --simulate=slow` | Terminal + Browser | *"Next, we demonstrate honest failure simulation using `--simulate=slow`. Notice the amber badge in both the terminal and browser HUD clearly stating that a staged simulation is running.<br><br>On Attempt 1, the response is artificially delayed past the 15-second timeout. Notice the terminal displaying a live backoff countdown. Attempt 2 launches in a completely fresh, isolated browser context, loads cleanly, and recovers with outcome `SUCCESS_AFTER_RETRY`."* |
| **1:15 – 2:10**<br>*(~55s)* | **Scene 3: Missing Element Simulation (Exhausted Failure)**<br><br>Command:<br>`npm run scrape:headed -- --product=915 --simulate=missing` | Terminal + Browser | *"Now, we test error exhaustion with `--simulate=missing`. In this run, the price carrier is stripped from the DOM after extraction begins. The scraper avoids falling into the honeypot trap, identifies that no valid carrier exists, and throws a `NO_PRICE_CARRIER` parse error.<br><br>Watch the backoff timer count down across all 3 attempts. After exhausting 3 attempts, the run terminates honestly with outcome `FAILED`."* |
| **2:10 – 2:45**<br>*(~35s)* | **Scene 4: Database & Dashboard Audit**<br><br>Action: Switch browser to React dashboard (`http://localhost:5173/products/915`). Click into Product Detail view. | React Frontend UI | *"Now looking at the product detail page in our web dashboard: in the Execution Logs table, all three runs are recorded with full fidelity. We see the `success` run from Scene 1, the `success_after_retry` run from Scene 2 with 2 attempts, and the `failed` run from Scene 3.<br><br>Crucially, looking at the Price History chart and table: only the successful runs wrote price records. The failed run recorded zero price history entries, proving our defense-in-depth data integrity."* |
| **2:45 – 3:00**<br>*(~15s)* | **Wrap Up / Summary** | Dashboard | *"Every run exercises the full production orchestrator, real database writes in Supabase, and transparent staged simulations."* |

---

## 4. Resetting Test Data Between Takes

If you wish to clear previous test scrape runs before recording a new take without deleting the tracked product itself, run the following SQL statements in your Supabase SQL Editor.

### Option A: Reset Logs for a Specific Product (e.g. Product 915)

```sql
-- 1. Find product ID for store product 915
DO $$
DECLARE
  target_product_id uuid;
BEGIN
  SELECT id INTO target_product_id FROM tracked_products WHERE store_product_id = '915' LIMIT 1;

  IF target_product_id IS NOT NULL THEN
    -- Delete price history rows generated for this product
    DELETE FROM price_history WHERE product_id = target_product_id;

    -- Delete scrape logs generated for this product
    DELETE FROM scrape_logs WHERE product_id = target_product_id;

    -- Reset last_scraped_at timestamp on the product record
    UPDATE tracked_products
    SET last_scraped_at = NULL,
        updated_at = NOW()
    WHERE id = target_product_id;

    RAISE NOTICE 'Test data for product 915 successfully cleared.';
  ELSE
    RAISE NOTICE 'Product 915 was not found.';
  END IF;
END $$;
```

### Option B: Quick One-Liner (Clear All Scrape Logs & Price History)

If you are running in a local/demo development database and want to reset all scrape history across all products while retaining your tracked product catalogue:

```sql
-- Truncate scrape logs and price history cascadingly
TRUNCATE TABLE price_history, scrape_logs CASCADE;

-- Reset last_scraped_at timestamps
UPDATE tracked_products SET last_scraped_at = NULL;
```

---

## 5. Verification Checklist

Before starting your recording, verify the following:

- [x] Store server is running at `http://localhost:3000` (or `https://demo.inelabteamdev.com`).
- [x] Backend is built (`cd backend && npm run build`).
- [x] Frontend dev server is running at `http://localhost:5173`.
- [x] `HEADLESS=false` is supported either via `.env` or passed automatically by `npm run scrape:headed`.
- [x] Screen recorder is capturing at 1080p (or 1440p) with both terminal font size and browser window clearly legible.
