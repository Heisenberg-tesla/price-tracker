#!/usr/bin/env bash
# =============================================================================
# smoke-test.sh — Post-Deploy Smoke Test for Price Tracker
#
# Usage:
#   chmod +x scripts/smoke-test.sh
#   BACKEND=https://your-service.onrender.com \
#   CRON_SECRET=your-secret \
#   ./scripts/smoke-test.sh
#
# Optional env vars:
#   STORE_PRODUCT_ID   — Product ID to track (default: 915)
#   SKIP_SCRAPE        — Set to "1" to skip the live scrape check (faster)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BACKEND="${BACKEND:-}"
CRON_SECRET="${CRON_SECRET:-}"
STORE_PRODUCT_ID="${STORE_PRODUCT_ID:-915}"
SKIP_SCRAPE="${SKIP_SCRAPE:-0}"

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo -e "  ${GREEN}✔ PASS${RESET} $1"; ((PASS_COUNT++)); }
fail() { echo -e "  ${RED}✖ FAIL${RESET} $1"; ((FAIL_COUNT++)); }
info() { echo -e "  ${CYAN}ℹ${RESET} $1"; }
header() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${RESET}"; }

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------
if [[ -z "$BACKEND" ]]; then
  echo -e "${RED}ERROR: BACKEND env var is required.${RESET}"
  echo "  Example: BACKEND=https://price-tracker-backend.onrender.com"
  exit 1
fi

if [[ -z "$CRON_SECRET" ]]; then
  echo -e "${RED}ERROR: CRON_SECRET env var is required.${RESET}"
  exit 1
fi

BACKEND="${BACKEND%/}"  # Strip trailing slash

echo ""
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}  PRICE TRACKER — POST-DEPLOY SMOKE TEST${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo -e "  Backend:  ${BOLD}$BACKEND${RESET}"
echo -e "  Product:  ${BOLD}$STORE_PRODUCT_ID${RESET}"
echo -e "  Time:     $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# ---------------------------------------------------------------------------
# Check 1 — Health endpoint
# ---------------------------------------------------------------------------
header "Check 1 — Health Endpoint"

HEALTH=$(curl -sf "$BACKEND/health" 2>/dev/null || echo "CURL_FAILED")

if [[ "$HEALTH" == "CURL_FAILED" ]]; then
  fail "Could not reach $BACKEND/health — is the service running?"
else
  STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','missing'))" 2>/dev/null || echo "parse_error")
  DB=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('dbConnected','false'))" 2>/dev/null || echo "parse_error")

  [[ "$STATUS" == "ok" ]] && pass "status=ok" || fail "status='$STATUS' (expected 'ok')"
  [[ "$DB" == "True" ]] && pass "dbConnected=true" || fail "dbConnected='$DB' (expected true) — check SUPABASE credentials on Render"
fi

# ---------------------------------------------------------------------------
# Check 2 — Catalog search
# ---------------------------------------------------------------------------
header "Check 2 — Catalog Search"

SEARCH=$(curl -sf "$BACKEND/api/store/search?q=laptop" 2>/dev/null || echo "CURL_FAILED")

if [[ "$SEARCH" == "CURL_FAILED" ]]; then
  fail "Search endpoint unreachable"
else
  IS_ARRAY=$(echo "$SEARCH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if isinstance(d,list) else 'no')" 2>/dev/null || echo "parse_error")
  HAS_PRICE=$(echo "$SEARCH" | python3 -c "import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else []; print('yes' if any('price' in x for x in items) else 'no')" 2>/dev/null || echo "no")

  [[ "$IS_ARRAY" == "yes" ]] && pass "Returns JSON array" || fail "Did not return a JSON array: $SEARCH"
  [[ "$HAS_PRICE" == "no" ]] && pass "No 'price' field in search results (correct)" || fail "Search results contain a 'price' field — price must not be returned from catalog search"
fi

# ---------------------------------------------------------------------------
# Check 3 — List tracked products
# ---------------------------------------------------------------------------
header "Check 3 — List Tracked Products"

PRODUCTS=$(curl -sf "$BACKEND/api/products" 2>/dev/null || echo "CURL_FAILED")

if [[ "$PRODUCTS" == "CURL_FAILED" ]]; then
  fail "Products list endpoint unreachable"
else
  HAS_DATA=$(echo "$PRODUCTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'data' in d else 'no')" 2>/dev/null || echo "no")
  HAS_COUNT=$(echo "$PRODUCTS" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'count' in d else 'no')" 2>/dev/null || echo "no")

  [[ "$HAS_DATA" == "yes" ]] && pass "Response has 'data' array" || fail "Response missing 'data' field: $PRODUCTS"
  [[ "$HAS_COUNT" == "yes" ]] && pass "Response has 'count' field" || fail "Response missing 'count' field"
fi

# ---------------------------------------------------------------------------
# Check 4 — Track a product (idempotent via 409 on duplicate)
# ---------------------------------------------------------------------------
header "Check 4 — Track Product (store_product_id=$STORE_PRODUCT_ID)"

PRODUCT_URL="https://demo.inelabteamdev.com/product/$STORE_PRODUCT_ID"

TRACK_RESPONSE=$(curl -sf -w "\n%{http_code}" -X POST "$BACKEND/api/products" \
  -H "Content-Type: application/json" \
  -d "{\"productUrl\": \"$PRODUCT_URL\", \"name\": \"Test Product $STORE_PRODUCT_ID\", \"scrapeIntervalMinutes\": 120}" \
  2>/dev/null || echo -e "\nCURL_FAILED")

TRACK_BODY=$(echo "$TRACK_RESPONSE" | sed '$d')
TRACK_STATUS=$(echo "$TRACK_RESPONSE" | tail -n1)

if [[ "$TRACK_STATUS" == "CURL_FAILED" ]]; then
  fail "Could not reach POST /api/products"
  PRODUCT_ID=""
elif [[ "$TRACK_STATUS" == "201" ]]; then
  PRODUCT_ID=$(echo "$TRACK_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
  pass "Product tracked (HTTP 201), id=$PRODUCT_ID"
elif [[ "$TRACK_STATUS" == "409" ]]; then
  info "Product already tracked (HTTP 409 — idempotent, not a failure)"
  # Fetch existing product id by matching on product_url
  PRODUCT_ID=$(curl -sf "$BACKEND/api/products" 2>/dev/null \
    | python3 -c "import sys,json; items=json.load(sys.stdin).get('data',[]); match=[x for x in items if x.get('product_url')=='https://demo.inelabteamdev.com/product/$STORE_PRODUCT_ID']; print(match[0]['id'] if match else '')" 2>/dev/null || echo "")
  pass "Duplicate track correctly returned 409"
else
  fail "Unexpected HTTP $TRACK_STATUS from POST /api/products: $TRACK_BODY"
  PRODUCT_ID=""
fi

# ---------------------------------------------------------------------------
# Check 5-7 — Scrape, history, logs (skippable)
# ---------------------------------------------------------------------------
if [[ -n "$PRODUCT_ID" && "$SKIP_SCRAPE" != "1" ]]; then

  header "Check 5 — Manual Scrape Trigger"

  SCRAPE_RESPONSE=$(curl -sf -w "\n%{http_code}" -X POST "$BACKEND/api/products/$PRODUCT_ID/scrape" \
    2>/dev/null || echo -e "\nCURL_FAILED")

  SCRAPE_BODY=$(echo "$SCRAPE_RESPONSE" | sed '$d')
  SCRAPE_STATUS=$(echo "$SCRAPE_RESPONSE" | tail -n1)

  if [[ "$SCRAPE_STATUS" == "202" ]]; then
    LOG_ID=$(echo "$SCRAPE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('logId',''))" 2>/dev/null || echo "")
    pass "Scrape queued (HTTP 202), logId=$LOG_ID"
    info "Waiting 45s for Playwright to complete..."
    sleep 45
  elif [[ "$SCRAPE_STATUS" == "409" ]]; then
    pass "Scrape already running (HTTP 409 — another run in progress)"
    info "Waiting 30s for it to finish..."
    sleep 30
  else
    fail "Unexpected HTTP $SCRAPE_STATUS from scrape trigger: $SCRAPE_BODY"
  fi

  header "Check 6 — Price History"

  HISTORY=$(curl -sf "$BACKEND/api/products/$PRODUCT_ID/history" 2>/dev/null || echo "CURL_FAILED")

  if [[ "$HISTORY" == "CURL_FAILED" ]]; then
    fail "Price history endpoint unreachable"
  else
    RECORD_COUNT=$(echo "$HISTORY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo "0")
    if [[ "$RECORD_COUNT" -gt 0 ]]; then
      PRICE=$(echo "$HISTORY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('price_cents',0))" 2>/dev/null || echo "0")
      pass "Price history has $RECORD_COUNT record(s), latest price_cents=$PRICE"
    else
      fail "Price history is empty — scrape may have failed. Check /api/products/$PRODUCT_ID/logs"
    fi
  fi

  header "Check 7 — Scrape Logs"

  LOGS=$(curl -sf "$BACKEND/api/products/$PRODUCT_ID/logs" 2>/dev/null || echo "CURL_FAILED")

  if [[ "$LOGS" == "CURL_FAILED" ]]; then
    fail "Scrape logs endpoint unreachable"
  else
    LOG_COUNT=$(echo "$LOGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo "0")
    if [[ "$LOG_COUNT" -gt 0 ]]; then
      OUTCOME=$(echo "$LOGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('outcome','unknown'))" 2>/dev/null || echo "unknown")
      ERROR_TYPE=$(echo "$LOGS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('error_type') or 'null')" 2>/dev/null || echo "unknown")
      if [[ "$OUTCOME" == "success" || "$OUTCOME" == "success_after_retry" ]]; then
        pass "Most recent log: outcome=$OUTCOME, error_type=$ERROR_TYPE"
      else
        fail "Most recent log: outcome=$OUTCOME, error_type=$ERROR_TYPE — scrape did not succeed"
      fi
    else
      fail "No scrape logs found"
    fi
  fi

else
  [[ "$SKIP_SCRAPE" == "1" ]] && info "Skipping scrape checks (SKIP_SCRAPE=1)"
  [[ -z "$PRODUCT_ID" ]] && info "Skipping scrape checks (no product ID resolved)"
fi

# ---------------------------------------------------------------------------
# Check 8 — Cron authentication
# ---------------------------------------------------------------------------
header "Check 8 — Cron Endpoint Authentication"

NO_AUTH=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BACKEND/api/cron/scrape-due" 2>/dev/null || echo "000")
WITH_AUTH=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BACKEND/api/cron/scrape-due" \
  -H "X-Cron-Secret: $CRON_SECRET" 2>/dev/null || echo "000")

[[ "$NO_AUTH" == "401" ]] && pass "Unauthenticated request rejected (HTTP 401)" || fail "Expected 401 without auth, got HTTP $NO_AUTH"
[[ "$WITH_AUTH" == "200" || "$WITH_AUTH" == "409" ]] && pass "Authenticated request accepted (HTTP $WITH_AUTH)" || fail "Expected 200/409 with correct secret, got HTTP $WITH_AUTH"

# ---------------------------------------------------------------------------
# Check 9 — Production error responses (no stack traces)
# ---------------------------------------------------------------------------
header "Check 9 — Production Error Response Format"

ERR_RESP=$(curl -sf "$BACKEND/api/products/not-a-real-uuid" 2>/dev/null || echo "CURL_FAILED")

if [[ "$ERR_RESP" == "CURL_FAILED" ]]; then
  fail "Error endpoint unreachable"
else
  HAS_STACK=$(echo "$ERR_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); err=d.get('error',{}); print('yes' if 'stack' in str(err) and err.get('details') and 'at ' in str(err.get('details','')) else 'no')" 2>/dev/null || echo "no")
  HAS_CORRELATION=$(echo "$ERR_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'correlationId' in d.get('error',{}) else 'no')" 2>/dev/null || echo "no")

  [[ "$HAS_STACK" == "no" ]] && pass "No stack trace in error response (correct for production)" || fail "Stack trace found in error response — check NODE_ENV=production on Render"
  [[ "$HAS_CORRELATION" == "yes" ]] && pass "correlationId present in error response" || fail "correlationId missing from error response"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  SMOKE TEST SUMMARY${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}Passed: $PASS_COUNT${RESET}"
echo -e "  ${RED}Failed: $FAIL_COUNT${RESET}"
echo ""

if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}  ✔ All checks passed — deployment is healthy.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}  ✖ $FAIL_COUNT check(s) failed — see output above.${RESET}"
  echo -e "  See ${CYAN}docs/DEPLOYMENT.md#10-troubleshooting${RESET} for remediation steps."
  exit 1
fi
