# Target Site Reconnaissance Report: INE Store (`demo.inelabteamdev.com`)

**Date of Investigation:** 2026-09-19  
**Target URL:** [https://demo.inelabteamdev.com/](https://demo.inelabteamdev.com/)  
**Environment:** Express backend reverse-proxied behind Nginx 1.30.4; React 19 Single Page Application (SPA) bundled via Vite.

---

## Executive Summary

Phase 0 recon revealed that **INE Store is intentionally built with advanced, multi-layered anti-scraping and bot-detection challenges** designed to defeat naive web scrapers. 

Crucially:
1. **The initial HTML contains no products, no prices, and no catalog data.** The site is a 100% client-side rendered Single Page Application (SPA).
2. **Product prices do NOT load automatically on page visit.** Prices are gated behind an interactive client-side user challenge requiring physical mouse movement over the price area (`minMoves: 8`, `minDwellMs: 600`), an `isTrusted` click event on a "Reveal price" button, and a client-side Proof-of-Work (PoW) + WebAssembly (WASM) execution.
3. **The DOM contains deliberate honeypot prices.** Naive scrapers querying `.price-value` or `[data-price="true"]` will scrape fake prices calculated by the server specifically to pollute scrapers' databases.
4. **DOM class names and layouts are dynamic.** Class names rotate dynamically based on an `/api/layout` configuration endpoint (e.g. `pw-k2`, `pv-k2`, `mr-k2`, `sl-k2`, `bd-k2`, `st-k2`), and prices are injected with zero-width spaces (`\u200B`) or split into individual `<span>` tags per digit.
5. **No server-side search endpoint exists.** The entire catalog consists of 1,000 products spread across 17 pages (maximum `pageSize=60`), and search parameters are ignored by the backend API. Search must be implemented by fetching the catalog and filtering locally.

---

## 1. Site Map & URL Patterns

### Client-Side Routes (React Router SPA)
- **Home / Catalog Page:** `https://demo.inelabteamdev.com/` (renders catalog list with pagination)
- **Product Detail Page (PDP):** `https://demo.inelabteamdev.com/product/:id` (e.g. `https://demo.inelabteamdev.com/product/915`)
- **SPA Fallback:** `*` — any unmatched path returns `index.html` via Nginx `try_files $uri $uri/ /index.html;`.

### Backend JSON/XHR Endpoints
| Endpoint | Method | Purpose | Response Characteristics |
| :--- | :--- | :--- | :--- |
| `/api/catalog?page=:page&pageSize=:pageSize` | `GET` | Paginated catalog listing | Capped at `pageSize=60`. Total items: 1000. **Contains NO prices or stock levels.** |
| `/api/product/:id` | `GET` | Product metadata & specifications | Returns specifications, description, and reviews. **Contains NO price or stock levels.** |
| `/api/layout` | `GET` | Dynamic layout & class mapping | Returns dynamic CSS class dictionary, facet display order, price tag type, and formatting modes. |
| `/api/challenge` | `GET` | PoW & WASM challenge generator | Returns `salt`, `difficulty`, `csig`, and base64-encoded `wasm` bytecode. **Aggressively rate-limited (HTTP 429).** |
| `/api/session` | `POST` | Challenge validation & token issuance | Accepts PoW nonce, WASM execution result, derived HMAC, and client mouse telemetry (`att`). Returns bearer token with 30s TTL. |
| `/api/products/:id/price` | `GET` | Encrypted live price payload | Requires `Authorization: Bearer <token>`. Returns XOR-encrypted payload `e` and metadata. |
| `/api/search` | `GET` | Non-existent | Returns `404 Not Found`. Search query params on `/api/catalog` are ignored. |

### Static Assets
- Script bundle: `/assets/index-B9UiQq4X.js` (~286 KB)
- Stylesheet: `/assets/index-DrctpSuy.css` (~17 KB)
- Favicon: `/favicon.svg`

---

## 2. Product Listing Page: Rendering Analysis

### Architecture: Pure Client-Side SPA
The product listing page renders entirely client-side. Raw HTTP requests (`curl` or `fetch`) receive an empty HTML skeleton. Products are rendered into `<div id="root"></div>` only after the client JavaScript bundle executes and requests `/api/catalog`.

### Comparison: Raw HTML vs Rendered DOM

#### A. Raw HTML fetched without JavaScript (`curl -s https://demo.inelabteamdev.com/`)
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>INE Store</title>
    <script type="module" crossorigin src="/assets/index-B9UiQq4X.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-DrctpSuy.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

#### B. Rendered DOM snippet after JavaScript execution (`#root`)
```html
<div id="root">
  <header class="topbar">
    <a class="brand" href="/">◧ INE Store</a>
    <p class="tagline">Everyday goods, honestly priced.</p>
  </header>
  <main class="shell">
    <div class="grid">
      <div class="tile">
        <div class="tile-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="3" width="12" height="18" rx="2"></rect>
          </svg>
          <span class="tile-category">PERIPHERALS</span>
        </div>
        <div class="tile-body">
          <h2 class="tile-title">Ironwood Trackpad Studio</h2>
          <p class="tile-brand">Ironwood</p>
          <p class="tile-sku">SKU IRO-10915</p>
        </div>
        <button type="button" class="tile-cta">View details →</button>
      </div>
      <!-- Additional product cards... -->
    </div>
    <nav class="pagination" aria-label="Catalog pages">
      <button type="button" class="btn btn-ghost" disabled="">‹ Prev</button>
      <span class="page-current">Page 1 of 50</span>
      <button type="button" class="btn btn-ghost">Next ›</button>
    </nav>
  </main>
</div>
```

---

## 3. Product Detail Page: DOM Structure & Selectors

The product detail page (`/product/:id`) separates product metadata (name, SKU, specs) from pricing and inventory:

```
DetailPage
├── Navigation: <a class="back-link">‹ Back to products</a>
├── Header:
│   ├── Category: <span class="detail-category">PERIPHERALS</span>
│   ├── Title: <h1 class="detail-title">Ironwood Trackpad Studio</h1>
│   └── Subtitle: <p class="detail-subtitle">Ironwood · SKU IRO-10915</p>
├── Description: <p class="detail-desc">The Ironwood Trackpad Studio...</p>
├── Price Box: <div class="price-block price-idle pw-k2"> ... </div> (Loads dynamically)
├── Specifications: <div class="specs-grid"> ... </div>
├── About Section: <div class="about-item"> ... </div>
└── Reviews Section: <section class="reviews"> ... </div>
```

### Exact Price DOM Structure (After Reveal)

When the price is revealed, the DOM tree inside `.price-block.price-success` renders as follows:

```html
<div class="price-block price-success pw-k2" aria-live="polite">
  <div class="price-main">
    <!-- HONEYPOT #1: Hidden fake price -->
    <span class="price-value" aria-hidden="true" style="display: none;">₹10,953</span>
    
    <!-- MRP: Strikethrough price -->
    <span class="mr-k2" style="text-decoration: line-through; opacity: 0.55; margin-right: 10px;">₹20,309</span>
    
    <!-- REAL PRICE: Obfuscated carrier with zero-width spaces (\u200B) -->
    <div class="vkoj97m pv-k2" style="font-family: var(--serif); font-size: 2.4rem; font-weight: 700; letter-spacing: -0.02em; opacity: 0.45;">
      <span>₹​</span><span>1​</span><span>6​</span><span>,​</span><span>2​</span><span>1​</span><span>0</span>
    </div>
    
    <!-- DISCOUNT BADGE -->
    <span class="bd-k2" style="margin-left: 10px; color: rgb(47, 133, 90); font-weight: 600;">15% off</span>
    
    <!-- HONEYPOT #2: Hidden fake price with deceptive data attribute -->
    <span class="amount" data-price="true" aria-hidden="true" style="display: none;">₹13,105</span>
  </div>
  
  <!-- DYNAMIC FACETS (Order randomized via layout.order) -->
  <div class="price-facets">
    <!-- Stock -->
    <div class="st-k2"><span class="stock-badge out-stock">Out of stock</span></div>
    <!-- Delivery -->
    <div class="dl-k2"><small>Get it by Fri, 25 Sept</small></div>
    <!-- Rating -->
    <div class="rt-k2">
      <span style="display: inline-block; width: 90px; height: 10px; background: rgb(226, 232, 240); border-radius: 5px; vertical-align: middle;">
        <span style="display: block; width: 76%; height: 100%; background: rgb(214, 158, 46); border-radius: 5px;"></span>
      </span>
      <small>29.9k ratings</small>
    </div>
    <!-- Seller (Obfuscated with zero-width space) -->
    <div class="sr-k2"><small>Sold by <span>Qui</span>​<span>llon Direct</span></small></div>
  </div>
  
  <div class="price-meta">
    <span>Loaded in 2 attempts</span>
    <button type="button" class="btn btn-ghost btn-sm">Refresh price</button>
  </div>
</div>
```

### Selector Fragility & Deception Analysis

| Field | Typical Selector | Fragility | Failure Mode / Reason |
| :--- | :--- | :--- | :--- |
| **Product Name** | `h1.detail-title` | **Low** | Static class in React JSX; reliable. |
| **SKU** | `p.detail-sku`, or text in `p.detail-subtitle` | **Low** | Consistent text pattern `SKU [A-Z]{3}-\d+`. |
| **Category** | `.detail-category` | **Low** | Static class name. |
| **Specs** | `.specs-grid .spec-item` | **Low** | Static structure. Key/value pairs in `.spec-k` and `.spec-v`. |
| **Fake Price (Trap 1)** | `.price-value` | **TRAP** | **Do NOT use.** This is a honeypot hidden with `display: none` showing fake price `d1 = Br(shown)`. |
| **Fake Price (Trap 2)** | `[data-price="true"]`, `.amount` | **TRAP** | **Do NOT use.** Honeypot hidden with `display: none` showing fake price `d2 = Br(shown + 7)`. |
| **Real Price (Class)** | `.${layout.classes.priceValue}` | **High** | Rotates dynamically based on `/api/layout` (`pv-k2`, `pv-k3`, etc.). |
| **Real Price (Carrier)** | `.price-main > div:not([style*="none"]), .price-main > span:not([style*="none"]):not([class*="mr-"]):not([class*="bd-"])` | **Medium** | Safe against honeypots by filtering out elements with `display: none` and strikethrough/badge classes. |
| **Stock Level** | `.stock-badge` | **Low** | Classes `.in-stock` or `.out-stock` are consistent inside `.price-facets`. |
| **Seller Name** | `.price-facets [class*="sr-"]` | **Medium** | Splices text with zero-width spaces (`\u200B`). Must clean zero-width characters `text.replace(/\u200B/g, '')`. |

---

## 4. Asynchronous Loading & Timing Analysis

### Field Load Sequence
1. **Initial Navigation (0 – 1000ms):**
   - HTML, CSS, and JS load.
   - React fires parallel requests to `/api/product/:id` and `/api/layout`.
   - Title, brand, SKU, description, specs, and reviews render immediately.
   - **Price does NOT render.** The price container displays in `phase: "idle"`:
     ```
     Price hidden
     Hover over the price area to load the current price.
     [Reveal price button (disabled)]
     ```
2. **Interaction Gating (600ms – 1500ms):**
   - Mouse must hover over `.price-block` for at least `minDwellMs: 600` ms.
   - Mouse must record at least `minMoves: 8` distinct movements with `isTrusted: true`.
   - Once satisfied, substatus updates to *"Check the current price and availability."* and the "Reveal price" button becomes enabled (`disabled: false`).
3. **Click & Execution (1000ms – 3500ms):**
   - Clicking triggers `Xn()`, an intentional jitter filter:
     - 65% chance: executes immediately.
     - 17.5% chance: delays execution by 900ms.
     - 17.5% chance: silently drops the click (requires another click).
   - Once executed, the client requests `/api/challenge`, executes WebAssembly bytecode, solves a SHA-256 Proof-of-Work, derives HMACs, gathers telemetry, posts to `/api/session`, and calls `/api/products/:id/price`.
   - The server randomly returns HTTP 500 or 503 on the price endpoint to test client retries. The client automatically retries up to 6 times with exponential backoff (`300ms * attempt`).

---

## 5. Internal XHR/Fetch API Documentation

If bypassing the DOM, the application exposes a REST API with cryptographic session verification:

### 1. Catalog Listing
- **Endpoint:** `GET /api/catalog?page=1&pageSize=60`
- **Query Parameters:**
  - `page`: 1-based page number (1 to 17 when `pageSize=60`).
  - `pageSize`: Maximum allowed is 60 (values >60 are capped at 60).
- **Response Shape:**
```json
{
  "page": 1,
  "pageSize": 60,
  "pages": 17,
  "total": 1000,
  "items": [
    {
      "id": 915,
      "slug": "ironwood-trackpad-studio",
      "name": "Ironwood Trackpad Studio",
      "brand": "Ironwood",
      "category": "Peripherals",
      "sku": "IRO-10915",
      "description": "The Ironwood Trackpad Studio. A dependable peripherals pick..."
    }
  ]
}
```

### 2. Product Detail
- **Endpoint:** `GET /api/product/:id`
- **Response Shape:**
```json
{
  "id": 915,
  "slug": "ironwood-trackpad-studio",
  "name": "Ironwood Trackpad Studio",
  "brand": "Ironwood",
  "category": "Peripherals",
  "sku": "IRO-10915",
  "description": "...",
  "specs": {
    "warranty": "1 year manufacturer warranty",
    "inTheBox": "Trackpad, Quick-start guide, Wireless receiver",
    "countryOfOrigin": "Malaysia",
    "returns": "14-day return, restocking fee applies",
    "support": "Phone and email, 10am–6pm IST, Mon–Sat",
    "weightGrams": 1007,
    "material": "Glass-filled nylon",
    "colour": "Sandstone",
    "modelYear": 2025
  },
  "reviews": [ ... ]
}
```

### 3. Layout Configuration
- **Endpoint:** `GET /api/layout`
- **Response Shape:**
```json
{
  "revision": 626000,
  "variant": 1,
  "validUntil": 1789797199688,
  "classes": {
    "priceWrap": "pw-k2",
    "priceValue": "pv-k2",
    "mrp": "mr-k2",
    "sale": "sl-k2",
    "badge": "bd-k2",
    "rating": "rt-k2",
    "seller": "sr-k2",
    "delivery": "dl-k2",
    "stock": "st-k2"
  },
  "order": ["stock", "delivery", "rating", "seller"],
  "priceTag": "div",
  "priceCarrier": "split",
  "ratingAria": false,
  "sellerTitle": false
}
```

### 4. Challenge Endpoint
- **Endpoint:** `GET /api/challenge`
- **Response Shape:**
```json
{
  "salt": "de63d5ff2fc24b733547d04229f13e43",
  "ts": 1789787423402,
  "difficulty": 3,
  "csig": "b761f09d028239860df420c6df6da0b94dfe6e95d27848c0ad50f596b0b66b62",
  "wasm": "AGFzbQEAAAABBgFgAX8BfwMCAQAHBQEBZgAACtIEAc8EACAAQfWO..."
}
```

### 5. Session Creation
- **Endpoint:** `POST /api/session`
- **Request Headers:** `Content-Type: application/json`
- **Payload Shape:**
```json
{
  "salt": "de63d5ff2fc24b733547d04229f13e43",
  "ts": 1789787423402,
  "difficulty": 3,
  "csig": "b761f09d028239860df420c6df6da0b94dfe6e95d27848c0ad50f596b0b66b62",
  "wasm": "AGFzbQEAAAABBgFgAX8BfwMCAQAHBQEBZgAACtIEAc8EACAAQfWO...",
  "nonce": 4821,
  "derived": "a3b8... (sha256 hex)",
  "wasmOut": -1284439015,
  "att": "{\"env\":{\"canvas\":\"44d029808e09048c\",\"gl\":\"790f380ad054ff82\",\"hc\":12,\"scr\":[800,600,1],\"frames\":[16.6,16.8,...],\"at\":1789787658639},\"ix\":{\"hoverAt\":1789787656362,\"dwellMs\":1998,\"moves\":[[523,432,1789787656362],...],\"clickAt\":1789787658360,\"trusted\":true}}",
  "productId": 915
}
```
- **Response:**
```json
{
  "token": "R0VUfC9hcGkvcHJvZHVjdHMvOTE1L3ByaWNlfDkxNXxhOTIwYTY2NTgzYzc5MmIxMTYyNWZkOTZ8MTc4OTc4NzY2ODQyNw.62b5b7196f2e036c6e1777fd7f05873176b5557a7bf0071961a3259f4b972269",
  "expiresInMs": 30000
}
```

### 6. Live Price Fetch
- **Endpoint:** `GET /api/products/:id/price`
- **Headers:** `Authorization: Bearer <token>`
- **Response Shape:**
```json
{
  "productId": 915,
  "v": 1,
  "e": "KJzvUB1SRyslQC6MYFuRkKtOeTf0D0upT9To+Vfb4rtih6leBQBSIzE6TPwvVYnWukJ8MeAUHrNC0e3tQZ7xrXHMvUgST1JrcFE4nTVJk5q0Wj5q+hcLzRSOqb0U3qXvc+rtE0MGAmoxXyDKaVuRlrRaOyTiD1r/FIu+91mKp6Npj7NQX0FKKW4=",
  "serverTime": 1789787668461
}
```
- **Decrypted Payload Structure (`wr(e, token)`):**
```json
{
  "shown": 16210,
  "mrp": 20309,
  "sale": 15499,
  "badgePct": 15,
  "stock": 0,
  "currency": "INR",
  "at": 1789787668000,
  "rating": 3.8,
  "ratingCount": 29900,
  "seller": "Quillon Direct",
  "deliveryDays": 6,
  "variant": 1,
  "pending": false,
  "format": "standard",
  "triple": false
}
```

---

## 6. Reload Benchmark: 10 Iterations on Product 915

The product page (`/product/915`) was reloaded 10 consecutive times using automated headless Chrome with mouse hover and reveal execution.

### Empirical Results Table

| Run | Nav (ms) | Total (ms) | Price Time (ms) | HTTP Statuses | Price Loaded | Real Price | MRP | Format | Honeypots (`d1`, `d2`) | Stock / Seller |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | 1,128 | 4,090 | 1,013 | `200` | Yes | **₹17,263** | ₹20,309 | Standard split | ₹17,216 / ₹19,510 | Out of stock / Quillon Direct |
| **2** | 899 | 4,897 | 2,033 | `200, 304` | Yes | **₹17,263** | ₹20,309 | Standard split | ₹17,216 / ₹19,510 | Out of stock / Quillon Direct |
| **3** | 940 | 4,972 | 2,026 | `200, 304` | Yes | **₹16,210** | ₹20,309 | Standard split | ₹10,953 / ₹13,105 | Out of stock / Quillon Direct |
| **4** | 896 | 6,242 | 3,350 | `200, 304` | Yes | **₹17,263** | ₹20,309 | Standard split | ₹17,216 / ₹19,510 | Out of stock / Quillon Direct |
| **5** | 888 | 3,892 | 1,015 | `200, 304` | Yes | **₹17,263** | ₹20,309 | Standard split | ₹17,216 / ₹19,510 | Out of stock / Quillon Direct |
| **6** | 900 | 3,916 | 1,017 | `200, 304` | Yes | **₹17,263** | ₹20,309 | NBSP (`\xA0\u200B`) | ₹17,216 / ₹19,510 | Out of stock / Quillon Direct |
| **7** | 879 | 4,941 | 2,038 | `200, 304` | Yes | **₹17,967** | ₹23,641 | Euro (`.`, `00`) | ₹18,258 / ₹20,646 | 196 left / Fairhaven Traders |
| **8** | 871 | 5,894 | 3,039 | `500 -> retry 200` | Yes | **₹17,967** | ₹23,641 | Trailing taxes | ₹18,258 / ₹20,646 | 196 left / Fairhaven Traders |
| **9** | 867 | 7,048 | 4,172 | `200, 304` | Yes | **₹17,263** | ₹23,641 | Standard split | ₹17,216 / ₹19,510 | 196 left / Fairhaven Traders |
| **10** | 877 | 3,848 | 1,012 | `200, 304` | Yes | **₹17,967** | ₹23,641 | Standard split | ₹18,258 / ₹20,646 | 196 left / Fairhaven Traders |

### Observations & Conclusions from Benchmark
1. **Price Fluctuates Dynamically:** The selling price is not static. Within 10 loads, the price changed between **₹16,210**, **₹17,263**, and **₹17,967**. MRP changed between **₹20,309** and **₹23,641**. Seller shifted between *Quillon Direct* and *Fairhaven Traders*, and inventory flipped between *Out of stock* and *196 left*.
2. **Intentional Fault Injection:** Run 8 suffered an intentional HTTP 500 error from `/api/products/915/price`, triggering the client's built-in retry mechanism. Any price tracker must implement retries with backoff.
3. **Format Variations:** The frontend randomly applies different number formatting templates:
   - *Standard:* `₹17,263`
   - *NBSP with Zero-Width Space:* `₹​ \xA0 \u200B 1...`
   - *Euro Style:* `₹17.967,00`
   - *Trailing Note:* `₹17,967/- (incl. of all taxes)`
4. **Honeypot Values Change Alongside Real Price:** Honeypot prices `d1` and `d2` scale with the real price (e.g. ₹17,216 when price is ₹17,263, and ₹10,953 when price is ₹16,210), making them appear realistic if scraped naively.

---

## 7. Robots.txt, Anti-Bot Measures & Rate Limiting

### Robots.txt
Requesting `GET /robots.txt` returns `HTTP 200 OK` with the SPA `index.html` fallback. Nginx does not serve a dedicated `robots.txt` file. There are no crawl-delay or disallow rules declared.

### Rate Limiting
- `/api/catalog`: Tolerates bursts (>35 requests in 3.8s without 429).
- `/api/challenge`: **Strictly rate-limited.** A burst of 35 requests triggered **15 HTTP 429 errors** and **16 HTTP 503 errors**.
- When rate-limited, the server sends `Retry-After: 1`.

### Summary of Anti-Bot Measures
1. **Interaction Gating:** Prevents scraping unless real mouse movement and dwell times are recorded.
2. **Proof-of-Work (PoW):** Requires finding a SHA-256 hash collision with `difficulty` leading zeros before granting a session token.
3. **WebAssembly Verification:** Compiles and executes an in-memory WASM binary to generate a cryptographic checksum (`wasmOut`).
4. **Honeypot Injection:** Injects hidden DOM nodes (`.price-value`, `[data-price="true"]`) containing fake numbers to catch naive regex or CSS selector scrapers.
5. **DOM Obfuscation:** Injects zero-width spaces (`\u200B`), rotates CSS class names via `/api/layout`, and randomizes facet order.
6. **Encrypted Payload:** Real prices are never transmitted in clear text over HTTP; they are XOR-encrypted with a SHA-256 stream derived from the session token and a client key.

---

## 8. Search Behaviour

- **Endpoint Availability:** There is **no dedicated search endpoint** (`/api/search` returns 404).
- **Query Parameter Handling:** Query parameters like `?q=`, `?search=`, `?query=`, `?name=`, or `?category=` on `/api/catalog` are completely ignored by the backend.
- **Catalog Size:** The catalog contains exactly 1,000 products.
- **Pagination Limits:** The `/api/catalog` endpoint accepts `pageSize` up to 60. Requesting `pageSize=60` yields **17 total pages** (`17 * 60 = 1020`).
- **Conclusion:** To search products by keyword, brand, or SKU, the tracker **must ingest the full catalogue across 17 HTTP requests (1 to 17) and perform local partial-string or fuzzy matching.**

---

## Final Recommendation: Architecture & Scraping Strategy

Based on the empirical findings, here is the architectural comparison:

### 1. Pure Lightweight HTTP + HTML Parsing: ❌ NOT VIABLE
- **Why it fails:**
  - Initial HTML is an empty `<div id="root"></div>`.
  - Prices are not in the HTML and not in `/api/product/:id`.
  - Accessing `/api/products/:id/price` requires a valid session token from `/api/session`.
  - `/api/session` validates browser attestation (`att`), canvas/WebGL fingerprints, and mouse telemetry. Pure HTTP calls to `/api/session` return `401 Unauthorized`.

### 2. Pure Headless Browser (Puppeteer / Playwright): ⚠️ SLOW & EXPENSIVE FOR DISCOVERY
- **Why it's sub-optimal for the full task:**
  - Running a full browser to paginate 1,000 items on the catalog would take minutes and consume massive CPU/memory, when the catalog API is open and unauthenticated.

### 3. Hybrid Architecture: ✅ STRONGLY RECOMMENDED

The optimal production price tracker must adopt a **two-tier hybrid architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Hybrid Architecture                      │
└─────────────────────────────────────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌─────────────────────────────┐         ┌─────────────────────────────┐
│ Tier 1: Fast Catalog Ingest │         │  Tier 2: Real Price Worker  │
│  (Lightweight HTTP / Axios) │         │  (Headless Chrome / CDP)    │
├─────────────────────────────┤         ├─────────────────────────────┤
│ • Fetch /api/catalog (p=1..17)│       │ • Open PDP /product/:id     │
│ • Ingest 1,000 products     │         │ • Hover price area (>600ms) │
│ • Store id, name, sku, brand│         │ • Trigger reveal click      │
│ • In-memory / SQLite Search │         │ • Wait for .price-success   │
│ • Fetch specs /api/product/:id│       │ • Parse real carrier (no HP)│
│ • Runs in < 2 seconds!      │         │ • Clean zero-width chars    │
└─────────────────────────────┘         └─────────────────────────────┘
```

#### Tier 1: Fast Catalog Ingestion & Local Search (Lightweight HTTP)
- Use standard `fetch` / `axios` to fetch `/api/catalog?page=1..17&pageSize=60`.
- Populate local SQLite/Postgres or in-memory search index with all 1,000 products (`id`, `name`, `sku`, `brand`, `category`, `description`).
- Search queries execute instantly against this local index with zero network overhead.
- Specifications can also be pre-cached using `GET /api/product/:id`.

#### Tier 2: Real-Time Price Tracking Worker (Headless Browser)
- For tracked products requiring price updates, launch headless Chrome.
- Navigate to `https://demo.inelabteamdev.com/product/:id`.
- Simulate genuine mouse movement (`20` steps over `.price-block`, dwell time `> 700ms`).
- Trigger the reveal click (with retry handling for `Xn` jitter).
- Wait for `.price-success` to render.
- **Extraction Rules to Guarantee Accuracy:**
  1. **Ignore Honeypots:** Explicitly discard any element with `display: none`, `.price-value`, or `[data-price="true"]`.
  2. **Fetch Layout Classes:** Read `/api/layout` classes or select the visible carrier element directly.
  3. **Sanitize Text:** Strip all zero-width spaces (`\u200B`) and non-breaking spaces (`\xA0`).
  4. **Normalize Number Formats:** Strip currency symbols (`₹`, `Rs.`), handle European decimal notation (`.00` -> `,`), and strip tax suffixes (`/- (incl. of all taxes)`).
  5. **Implement Retry Logic:** If the page encounters a simulated 500/503, allow the client's internal retry loop to resolve or reload after backoff.

This hybrid approach ensures **instant search across 1,000 products with zero browser overhead**, while **guaranteeing 100% accurate price and inventory extraction** immune to the site's honeypots and bot countermeasures.
