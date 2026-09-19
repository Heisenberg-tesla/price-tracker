# Price Tracker — Deployment Guide

> **Stack**: Render (backend) · Vercel (frontend) · Supabase (database) · cron-job.org (primary scheduler)
>
> **Free-tier throughout.** No paid plans required.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Generate Production Secrets](#2-generate-production-secrets)
3. [Supabase — Verify Database](#3-supabase--verify-database)
4. [Deploy Backend to Render](#4-deploy-backend-to-render)
5. [Deploy Frontend to Vercel](#5-deploy-frontend-to-vercel)
6. [Wire CORS After Both Deploy](#6-wire-cors-after-both-deploy)
7. [cron-job.org — Scheduling](#7-cron-joborg--scheduling)
8. [GitHub Actions — Backup Scheduler](#8-github-actions--backup-scheduler)
9. [Post-Deploy Smoke Test](#9-post-deploy-smoke-test)
10. [Troubleshooting](#10-troubleshooting)
11. [Architecture & Security Notes](#11-architecture--security-notes)

---

## 1. Prerequisites

| Tool | Required version | Notes |
|------|-----------------|-------|
| Node.js | >= 20 (locally) | Backend targets Node 22 on Render |
| Git | any | Repo must be pushed to GitHub |
| Supabase project | already provisioned | Migrations already applied |
| Render account | free tier | [render.com](https://render.com) |
| Vercel account | free tier (Hobby) | [vercel.com](https://vercel.com) |
| cron-job.org account | free tier | [cron-job.org](https://cron-job.org) |

Ensure the entire project is committed and pushed to GitHub before starting:

```bash
git add -A
git commit -m "chore: add render.yaml, vercel.json, deployment config"
git push origin main
```

---

## 2. Generate Production Secrets

**Do this before touching any deployment platform.** Never reuse local `.env` values in production.

### 2a. CRON_SECRET

Generate a cryptographically random 32-byte hex secret:

```bash
# Linux / macOS / Git Bash / WSL
openssl rand -hex 32
```

Example output (yours will differ):
```
a7f3c9e21b8d4f6a0e5c3b9d7f2a4e8c1b6d3f9a2e7c5b0d4f8a3c6e1b9d7f5
```

**Save this value.** You will paste it identically into:
- Render environment variables (`CRON_SECRET`)
- cron-job.org job header (`X-Cron-Secret`)
- GitHub Actions repository secret (`CRON_SECRET`)

> [!CAUTION]
> Never commit `CRON_SECRET` to Git. Never share it in Slack, email, or issue comments. If it leaks, rotate it by generating a new value and updating all three locations simultaneously.

---

## 3. Supabase — Verify Database

The database schema is already migrated. Before deploying, confirm the following:

### 3a. RLS is enabled

In the Supabase dashboard → Table Editor → each table, confirm that **Row Level Security (RLS) is ON** for `tracked_products`, `price_history`, `scrape_logs`, and `structure_snapshots`.

This can also be verified in the SQL editor:

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All `rowsecurity` values must be `true`.

### 3b. Only the service_role key is used server-side

The backend uses `SUPABASE_SERVICE_ROLE_KEY` (a JWT with `role=service_role`), which bypasses RLS for trusted server-side writes. This is correct and intentional — the backend IS the trust boundary.

**The `anon` key is never used anywhere in this project.** Verify:

```bash
# Should return no results
grep -r "anon" backend/src/
grep -r "SUPABASE_ANON" .
```

Both must return nothing. If the anon key appears anywhere in backend code, that is a security bug.

### 3c. Collect your Supabase credentials

From Supabase dashboard → Project Settings → API:

| Variable | Where to find it |
|----------|-----------------|
| `SUPABASE_URL` | "Project URL" — e.g. `https://abcdefgh.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | "service_role" JWT (NOT the `anon` key) |

> [!WARNING]
> The `service_role` key has full database access and bypasses RLS. Treat it with the same care as a database root password. It must only ever exist in server-side environment variables — never in frontend code, never in the browser.

---

## 4. Deploy Backend to Render

### 4a. Create a new Web Service via Blueprint

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect your GitHub repository
3. Render will detect `render.yaml` in the repo root and auto-configure the service

**If you prefer manual setup** (New → Web Service):

| Field | Value |
|-------|-------|
| **Repository** | Your GitHub repo |
| **Branch** | `main` |
| **Root directory** | `backend` |
| **Runtime** | Node |
| **Build command** | `npm ci && npm run build && npx playwright install chromium --with-deps` |
| **Start command** | `node dist/index.js` |
| **Health check path** | `/health` |
| **Plan** | Free |

### 4b. Set environment variables in Render

In your Render service → **Environment** tab, add each variable:

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | |
| `NODE_VERSION` | `22` | Render uses this to select Node runtime |
| `LOG_LEVEL` | `info` | |
| `SUPABASE_URL` | `https://your-project.supabase.co` | From section 3c |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | From section 3c — service_role JWT |
| `CRON_SECRET` | (generated in section 2a) | Min 16 chars, no default |
| `ALLOWED_ORIGINS` | (set after Vercel deploy — see section 6) | Comma-separated |
| `HEADLESS` | `true` | Always true in production |
| `STORE_BASE_URL` | `https://demo.inelabteamdev.com` | |
| `MAX_SCRAPE_ATTEMPTS` | `3` | |
| `CATALOG_CACHE_TTL_MS` | `600000` | |
| `STALE_PENDING_MS` | `600000` | |

> [!IMPORTANT]
> `PORT` is automatically injected by Render. Do **not** add it manually. The backend reads `process.env.PORT` via `env.ts` and Render guarantees it will be set.

### 4c. How Playwright works on Render

The build command `npx playwright install chromium --with-deps` does two things:

1. **Downloads the Chromium binary** into `~/.cache/ms-playwright/chromium-<build>/` (inside Render's build cache)
2. **Installs system-level OS dependencies** (`--with-deps`) — libglib, libnss, libatk, libdrm, libxkbcommon, and ~15 other Ubuntu packages that Chromium requires but Render's base image does not include. Omitting this flag causes:
   ```
   Host system is missing dependencies to run browsers.
   ```

The Chromium binary path is resolved automatically by Playwright at runtime via its built-in discovery mechanism — no manual `executablePath` configuration is needed.

The launch args in `browserFetcher.ts` are hardened for containers:

```typescript
'--no-sandbox',           // Required: Render containers are not privileged
'--disable-setuid-sandbox',
'--disable-dev-shm-usage', // Required: /dev/shm is limited to 64MB on Render
'--disable-gpu',           // No GPU in headless containers
```

### 4d. Confirm the deploy succeeded

After the first deploy (~5-7 minutes including Playwright download):

```bash
curl https://your-service.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 12.4,
  "version": "1.0.0",
  "dbConnected": true,
  "timestamp": "2026-09-19T11:00:00.000Z"
}
```

If `dbConnected` is `false`, your Supabase credentials are wrong or the Supabase project is paused.

> [!NOTE]
> **Free-tier cold starts**: Render's free tier spins down services after 15 minutes of inactivity. The first request after a cold start takes 20-60 seconds. This is why the 10-minute keep-alive cron (section 7b) exists. It is a disclosed, intentional design choice — not a workaround hiding a flaw.

---

## 5. Deploy Frontend to Vercel

### 5a. Import the project

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel will auto-detect it as a Vite project

### 5b. Configure the build

| Field | Value |
|-------|-------|
| **Framework Preset** | Vite |
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` (Vercel detects this automatically) |
| **Output Directory** | `dist` (Vercel detects this automatically) |
| **Install Command** | `npm ci` |

### 5c. Set environment variables in Vercel

In your Vercel project → **Settings** → **Environment Variables**:

| Variable | Value | Environment |
|----------|-------|-------------|
| `VITE_API_BASE_URL` | `https://your-render-service.onrender.com/api` | Production |

> [!IMPORTANT]
> The value must NOT have a trailing slash. It must end with `/api`.
>
> Example: `https://price-tracker-backend.onrender.com/api`

### 5d. SPA routing on Vercel

`frontend/vercel.json` contains the catch-all rewrite:

```json
{
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

This ensures that navigating directly to `/products/123` or refreshing the page on any client-side route does not return a 404.

### 5e. Deploy

Click **Deploy**. The build typically takes 30-60 seconds. Your Vercel URL will be something like `https://price-tracker-abc123.vercel.app`.

---

## 6. Wire CORS After Both Deploy

Once you have both URLs, update the `ALLOWED_ORIGINS` environment variable on Render:

1. Go to Render dashboard → your backend service → **Environment**
2. Find `ALLOWED_ORIGINS`
3. Set it to your Vercel production URL:
   ```
   https://price-tracker-abc123.vercel.app
   ```
   If you have multiple frontend origins, comma-separate them:
   ```
   https://price-tracker-abc123.vercel.app,https://your-custom-domain.com
   ```
4. Click **Save Changes** — Render will automatically redeploy

---

## 7. cron-job.org — Scheduling

**cron-job.org is the primary scheduler (system of record)**. The GitHub Actions workflow (section 8) is only a redundant backup.

Create an account at [cron-job.org](https://cron-job.org) and configure two jobs:

### 7a. Job 1 — Scrape-Due Trigger (Primary Scheduler)

| Setting | Value |
|---------|-------|
| **Title** | `Price Tracker — Scrape Due (Primary)` |
| **URL** | `https://your-service.onrender.com/api/cron/scrape-due` |
| **Schedule** | Every 2 hours (`0 */2 * * *`) |
| **Request method** | `POST` |
| **Request timeout** | `300` seconds |
| **Retries on failure** | `2` (with 60s delay between retries) |

**Request headers** (add via "Headers" section):

| Header name | Value |
|-------------|-------|
| `X-Cron-Secret` | (the value generated in section 2a) |
| `Content-Type` | `application/json` |

**Expected response codes**: `200` (ran jobs or no jobs due), `409` (already running — not a failure).

### 7b. Job 2 — Keep-Alive Ping

A disclosed, intentional keep-alive mechanism for Render's free tier. Without this 10-minute ping, the service sleeps after 15 minutes of inactivity and the first real request experiences a 20-60 second cold start.

| Setting | Value |
|---------|-------|
| **Title** | `Price Tracker — Keep-Alive Ping` |
| **URL** | `https://your-service.onrender.com/health` |
| **Schedule** | Every 10 minutes (`*/10 * * * *`) |
| **Request method** | `GET` |
| **Request timeout** | `30` seconds |
| **Retries on failure** | `1` |

No auth headers needed — `/health` is a public endpoint.

---

## 8. GitHub Actions — Backup Scheduler

### 8a. Add repository secrets

In your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret name | Value |
|-------------|-------|
| `RENDER_BACKEND_URL` | `https://your-service.onrender.com` (no trailing slash, no `/api`) |
| `CRON_SECRET` | Exact same value as used in Render and cron-job.org |

### 8b. Verify the workflow fires

After adding secrets, go to GitHub → **Actions** → "Backup Scheduled Scraper" → **Run workflow** manually.

Expected output:
```
All required secrets are present.
Response HTTP Status: 200
Backup scrape trigger completed successfully.
```

### 8c. Schedule offset

The backup runs at `:30` past every even hour (`30 */2 * * *`), deliberately offset from cron-job.org's `:00` trigger to prevent simultaneous requests.

---

## 9. Post-Deploy Smoke Test

Run these checks in order after every deploy. All checks use `curl`. Replace placeholder values with your actual deployed URLs and secrets.

```bash
export BACKEND=https://your-service.onrender.com
export CRON_SECRET=your-production-cron-secret
```

### Check 1 — Health endpoint

```bash
curl -s "$BACKEND/health" | python3 -m json.tool
```

**Pass**: `status` is `"ok"`, `dbConnected` is `true`, `uptime` is positive.

---

### Check 2 — Catalog search

```bash
curl -s "$BACKEND/api/store/search?q=laptop" | python3 -m json.tool
```

**Pass**: JSON array returned (may be empty). Each element has `storeProductId`, `name`, `url`. No `price` field. No 500/503 with stack trace.

---

### Check 3 — List tracked products

```bash
curl -s "$BACKEND/api/products" | python3 -m json.tool
```

**Pass**: `{ "data": [...], "count": N }` — even if array is empty.

---

### Check 4 — Track a product

```bash
curl -s -X POST "$BACKEND/api/products" \
  -H "Content-Type: application/json" \
  -d '{"productUrl": "https://demo.inelabteamdev.com/product/915", "name": "Test Product 915", "scrapeIntervalMinutes": 120}' \
  | python3 -m json.tool
```

**Pass**: HTTP 201, product object with UUID `id`, `name`, `product_url`, `is_active: true`. Duplicate returns 409.

```bash
# Save the returned id
export PRODUCT_ID=<uuid-from-response>
```


---

### Check 5 — Manual scrape trigger

```bash
curl -s -X POST "$BACKEND/api/products/$PRODUCT_ID/scrape" \
  | python3 -m json.tool
```

**Pass**: HTTP 202 immediately. Wait 30-60 seconds for the scrape to run (Playwright takes 15-25s).

---

### Check 6 — Read back price history

```bash
curl -s "$BACKEND/api/products/$PRODUCT_ID/history" | python3 -m json.tool
```

**Pass**: Array with at least one record containing `price_cents` (integer > 0), `currency`, `in_stock`, `recorded_at`.

---

### Check 7 — Read back scrape logs

```bash
curl -s "$BACKEND/api/products/$PRODUCT_ID/logs" | python3 -m json.tool
```

**Pass**: At least one log. Most recent log: `outcome` is `"success"` or `"success_after_retry"`, `error_type` is null.

---

### Check 8 — Cron authentication

```bash
# Must be rejected (no secret header)
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BACKEND/api/cron/scrape-due"
# Expected: HTTP 401

# Must succeed (correct secret)
curl -s -X POST "$BACKEND/api/cron/scrape-due" \
  -H "X-Cron-Secret: $CRON_SECRET" \
  | python3 -m json.tool
# Expected: HTTP 200 with {"ran": N, "skipped": N, ...}
```

---

### Check 9 — No stack traces in production error responses

```bash
curl -s "$BACKEND/api/products/not-a-valid-uuid" | python3 -m json.tool
```

**Pass** (production): Response contains `{ "error": { "message": "...", "code": "...", "correlationId": "..." } }` — no `stack` field, no internal details.

---

### Check 10 — Frontend loads and connects

1. Open your Vercel URL
2. Dashboard loads with no console CORS errors
3. Search bar returns results or a graceful empty state
4. Navigate to `/products/<uuid>` and **hard-refresh** — must load, not 404

---

## 10. Troubleshooting

### `dbConnected: false` in health check

- `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is wrong on Render
- Supabase free-tier projects pause after 7 days of inactivity — restore from the Supabase dashboard

### `Host system is missing dependencies` (Playwright crash in Render logs)

Build command is missing `--with-deps`. In Render → Settings → Build command, set:
```
npm ci && npm run build && npx playwright install chromium --with-deps
```

### CORS error in browser console

`ALLOWED_ORIGINS` on Render does not include the Vercel URL. Update the value and save.

### `401 Unauthorized` from cron endpoint

`X-Cron-Secret` value does not match `CRON_SECRET` on Render. Rotate: generate new value with `openssl rand -hex 32`, update Render env, cron-job.org header, and GitHub Actions secret simultaneously.

### Scrape times out on first cold-start trigger

Render free-tier needs 20-60s to boot. The first scrape after a cold start may time out at the Playwright launch stage. The keep-alive ping (section 7b) prevents this during normal operation. Subsequent retries will succeed.

### GitHub Actions fails: `CRON_SECRET repository secret is missing`

Go to GitHub → repo → Settings → Secrets and variables → Actions → add `CRON_SECRET`.

### Frontend 404 on hard-refresh of `/products/:id`

`frontend/vercel.json` is missing or misconfigured. Verify the file exists and is committed. Vercel must serve `index.html` for all non-asset paths.

---

## 11. Architecture & Security Notes

### Why `service_role` key and not `anon` key?

The backend is the trust boundary. Using `service_role` from server-side code (which bypasses RLS) is correct: server-side code is trusted. The `anon` key is for unauthenticated browser access, which this project does not use.

### Stack traces stripped in production

`errorHandler.ts` explicitly gates implementation details on `NODE_ENV`:

```typescript
// Stack is logged server-side but never sent to clients in production
stack: env.NODE_ENV !== 'production' ? err.stack : undefined,
// Internal details stripped from API responses in production
details: env.NODE_ENV !== 'production' ? (details ?? err.stack) : details,
```

### CRON_SECRET has no default value

`env.ts` enforces:
```typescript
CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters long'),
```
No `.default()`. The app crashes loudly at boot if this is missing — a cron secret with a public fallback value defeats the purpose of having one.

### Free-tier scheduling rationale

| Scheduler | Role | Cadence |
|-----------|------|---------|
| cron-job.org | Primary (system of record) | Every 2h at :00 |
| GitHub Actions | Backup (safety net) | Every 2h at :30 (offset) |
| In-process `setInterval` | **Not used** | Render free tier sleeps — unreliable by design |

The keep-alive GET ping to `/health` every 10 minutes is a documented, disclosed strategy for free-tier deployments — not a hidden workaround.
