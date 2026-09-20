import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { ScrapedPriceData, SimulationMode, StepProgressEvent } from './types';
import { normalizePrice, normalizeStock, cleanInvisibleChars } from './normalizers';
import { computeStructureFingerprint, DomChildNodeSummary } from './structureSnapshot';

export interface FetchPriceOptions {
  productUrl: string;
  headless?: boolean;
  timeoutMs?: number;
  slowMo?: number;
  devtools?: boolean;
  attempt?: number;
  maxAttempts?: number;
  simulate?: SimulationMode;
  onStepProgress?: (event: StepProgressEvent) => void;
}

/**
 * Injects or updates an observable HUD banner on the rendered page
 */
async function updateBrowserBanner(
  page: Page | null,
  options: {
    attempt: number;
    maxAttempts: number;
    state: string;
    status?: 'info' | 'warn' | 'error' | 'success';
    simulate?: SimulationMode;
  },
) {
  if (!page) return;
  try {
    if (page.isClosed()) return;
    await page.evaluate(
      ({ attempt, maxAttempts, state, status, simulate }) => {
        let banner = document.getElementById('price-tracker-hud-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'price-tracker-hud-banner';
          banner.style.position = 'fixed';
          banner.style.top = '14px';
          banner.style.left = '50%';
          banner.style.transform = 'translateX(-50%)';
          banner.style.zIndex = '2147483647';
          banner.style.pointerEvents = 'none';
          banner.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
          banner.style.fontSize = '12px';
          banner.style.padding = '8px 16px';
          banner.style.borderRadius = '8px';
          banner.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.12)';
          banner.style.transition = 'all 0.2s ease-in-out';
          document.body.appendChild(banner);
        }

        const bgColors: Record<string, string> = {
          info: 'rgba(15, 23, 42, 0.95)',
          warn: 'rgba(69, 26, 3, 0.95)',
          error: 'rgba(76, 5, 25, 0.95)',
          success: 'rgba(2, 44, 34, 0.95)',
        };
        const textColors: Record<string, string> = {
          info: '#38bdf8',
          warn: '#fbbf24',
          error: '#f43f5e',
          success: '#34d399',
        };
        const borderColors: Record<string, string> = {
          info: '#334155',
          warn: '#78350f',
          error: '#881337',
          success: '#064e3b',
        };

        const currentStatus = status || 'info';
        banner.style.backgroundColor = bgColors[currentStatus] || bgColors['info']!;
        banner.style.color = textColors[currentStatus] || textColors['info']!;
        banner.style.border = `1px solid ${borderColors[currentStatus] || borderColors['info']!}`;

        let simBadge = '';
        if (simulate && simulate !== 'none') {
          simBadge = `<div style="font-size: 10px; color: #f59e0b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; display: flex; align-items: center; gap: 4px;">
            <span>⚠️ SIMULATION ACTIVE:</span>
            <span style="background: rgba(245, 158, 11, 0.2); padding: 1px 4px; border-radius: 3px;">${simulate.toUpperCase()}</span>
            <span style="opacity: 0.8; font-weight: normal; font-size: 9px;">(Staged fault injection)</span>
          </div>`;
        }

        banner.innerHTML = `
          ${simBadge}
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="background: rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px; color: #ffffff;">
              Attempt ${attempt}/${maxAttempts}
            </span>
            <span style="color: #f8fafc; font-weight: 500;">${state}</span>
          </div>
        `;
      },
      options,
    );
  } catch {
    // Ignore error if page is navigating or closing
  }
}

interface LayoutConfig {
  classes?: {
    priceWrap?: string;
    priceValue?: string;
    mrp?: string;
    badge?: string;
    stock?: string;
    rating?: string;
    seller?: string;
    delivery?: string;
  };
  priceTag?: string;
  priceCarrier?: string;
}

/**
 * Fetches dynamic layout mappings from the store's /api/layout endpoint.
 * Returns null if unavailable or failed.
 */
async function fetchLayoutConfig(baseUrl: string): Promise<LayoutConfig | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/layout`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      return (await res.json()) as LayoutConfig;
    }
  } catch (err) {
    logger.debug({ error: err }, 'Failed to fetch /api/layout, falling back to structural selectors');
  }
  return null;
}

/**
 * Tier 2: Fetches live price and stock using Playwright headless browser.
 * Executes realistic human mouse movement, dwell polling, trusted click with jitter retry,
 * and extracts price using honeypot-safe structural inspection.
 */
export async function fetchPriceWithBrowser(options: FetchPriceOptions): Promise<ScrapedPriceData> {
  const { productUrl } = options;
  const isHeadless =
    options.headless !== undefined
      ? options.headless
      : env.NODE_ENV === 'test'
      ? true
      : env.HEADLESS;
  const timeoutMs = options.timeoutMs || 35000;
  const slowMo = options.slowMo !== undefined ? options.slowMo : isHeadless ? 0 : 75;
  const attempt = options.attempt || 1;
  const maxAttempts = options.maxAttempts || 3;
  const simulate = options.simulate || 'none';

  const isProd = env.NODE_ENV === 'production';
  const defaultScrapeTimeoutMs = isProd ? 45000 : 15000;
  const timeoutScale = env.SCRAPE_TIMEOUT_MS / defaultScrapeTimeoutMs;

  const navTimeout = (isProd ? 60000 : 15000) * timeoutScale;
  const revealWaitTimeout = (isProd ? 30000 : 8000) * timeoutScale;
  const priceSuccessTimeout = (isProd ? 45000 : 15000) * timeoutScale;
  const clickRetryWait = (isProd ? 5000 : 600) * timeoutScale;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  // Observable HUD banner helper (active only in headed mode HEADLESS=false)
  const setBanner = async (state: string, status?: 'info' | 'warn' | 'error' | 'success') => {
    if (isHeadless || !page || page.isClosed()) return;
    await updateBrowserBanner(page, {
      attempt,
      maxAttempts,
      state,
      status,
      simulate,
    });
  };

  try {
    if (isProd) {
      options.onStepProgress?.({
        attempt,
        maxAttempts,
        phase: 'navigate',
        detail: 'Waiting 5s for cold-start initialization in production...',
        status: 'info',
      });
      await new Promise(r => setTimeout(r, 5000));
    }

    // 1. Launch Chromium (headed or headless, with optional slowMo/devtools)
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: isHeadless,
      slowMo,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Required on Linux containers (Render, Docker): /dev/shm is limited to
        // 64 MB by default. Without this flag Chromium writes shared memory to
        // /dev/shm and crashes on complex pages. This flag redirects the shared
        // memory usage to /tmp instead.
        '--disable-dev-shm-usage',
        // No GPU available in headless containers; avoids GPU init errors in logs.
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        ...(options.devtools ? ['--auto-open-devtools-for-tabs'] : []),
      ],

    };
    if (options.devtools) {
      (launchOptions as Record<string, unknown>).devtools = true;
    }
    browser = await chromium.launch(launchOptions);

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });

    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Track network responses for 429 rate-limiting or 5xx server errors
    let lastNetworkError: { status: number; url: string; statusText: string } | null = null;
    page.on('response', (response) => {
      const status = response.status();
      if (status === 429 || status >= 500) {
        lastNetworkError = {
          status,
          url: response.url(),
          statusText: response.statusText(),
        };
        logger.warn(
          { status, url: response.url() },
          'Observed rate limit or server error response during browser session',
        );
      }
    });

    // 2. Failure simulation route hooks
    //
    // IMPORTANT: Each simulation hook is scoped to this browser instance only.
    // Because browserFetcher.ts always tears down the ENTIRE browser in its finally
    // block, no route handler can ever leak into a subsequent attempt — every attempt
    // receives a completely fresh browser/context/page with zero inherited state.
    //
    // Pattern choice: '**/api/products/*/price'
    //   - Matches the store's price-reveal endpoint: /api/products/<id>/price
    //   - Does NOT match the main page document, product detail fetches, catalog
    //     calls, or any other resource — so the page title/DOM renders normally
    //     on every simulated attempt, giving a realistic "price service down" demo
    //     rather than a "whole page down" demo.
    //   - The `slow` sim targets the same narrow endpoint for consistency.
    if (simulate === 'slow' && attempt === 1) {
      options.onStepProgress?.({
        attempt,
        maxAttempts,
        phase: 'simulate_slow',
        detail: 'Simulating slow price-reveal response: delaying /api/products/*/price past 15s timeout on attempt 1',
        status: 'warn',
      });
      // Intercept only the price-reveal endpoint — the page itself loads normally
      await page.route('**/api/products/*/price', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 16000));
        await route.continue().catch(() => {});
      });
    } else if (simulate === 'error' && (attempt === 1 || attempt === 2)) {
      // Strictly guard: this block ONLY runs on attempts 1 and 2.
      // Attempt 3 gets a fresh browser with no route handlers.
      options.onStepProgress?.({
        attempt,
        maxAttempts,
        phase: 'simulate_error',
        detail: `Simulating price-endpoint server failure: intercepting /api/products/*/price with HTTP 500 on attempt ${attempt}`,
        status: 'warn',
      });
      // Intercept only the price-reveal API call — the product page title, images,
      // and DOM all render normally so the scraper reaches the reveal-button click
      // before the injected 500 is returned, giving a precise "price service down" demo.
      await page.route('**/api/products/*/price', async (route) => {
        await route
          .fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'SIMULATED_HTTP_500: Deliberate server fault injection for evaluation transparency' }),
          })
          .catch(() => {});
      });
    }

    logger.debug({ productUrl, isHeadless, attempt, simulate }, 'Navigating to product page in browser...');
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'navigate',
      detail: `Navigating to ${productUrl}`,
      status: 'info',
    });

    const navStart = Date.now();
    const navResponse = await page.goto(productUrl, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });
    const navMs = Date.now() - navStart;

    if (navResponse && navResponse.status() === 404) {
      throw new AppError(`Product not found at ${productUrl} (HTTP 404)`, 404, 'PRODUCT_NOT_FOUND');
    }

    if (navResponse && (navResponse.status() === 429 || navResponse.status() >= 500)) {
      throw new AppError(
        `Navigation failed with HTTP ${navResponse.status()} on ${productUrl}: ${navResponse.statusText()}`,
        navResponse.status(),
        'HTTP_ERROR',
      );
    }

    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'navigate',
      detail: `Page navigation complete (${navMs}ms)`,
      durationMs: navMs,
      status: 'info',
    });

    await setBanner('Page loaded. Waiting for product title...', 'info');

    // 3. Wait for base page to render (title visible)
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'wait_base_page',
      detail: 'Waiting for product title element (h1, .detail-title)...',
      status: 'info',
    });

    const titleLocator = page.locator('h1, .detail-title');
    try {
      await titleLocator.first().waitFor({ state: 'visible', timeout: navTimeout });
    } catch {
      // Check if product genuinely not found on page
      const notFoundText = await page.locator('body').innerText().catch(() => '');
      if (
        notFoundText.includes('Product not found') ||
        notFoundText.includes('Page not found') ||
        notFoundText.includes('404')
      ) {
        throw new AppError(`Product genuinely not found: ${productUrl}`, 404, 'PRODUCT_NOT_FOUND');
      }
      throw new AppError('Timeout waiting for product title to render', 504, 'TIMEOUT_BASE_PAGE');
    }

    const productName = (await titleLocator.first().textContent())?.trim() || '';
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'title_rendered',
      detail: `Product title confirmed: "${productName}"`,
      status: 'info',
    });

    await setBanner(`Product Title: "${productName}"`, 'info');

    // 4. Fetch dynamic layout classes if available
    const baseUrl = new URL(productUrl).origin;
    const layoutConfig = await fetchLayoutConfig(baseUrl);
    const dynamicPriceClass = layoutConfig?.classes?.priceValue;

    // 5. Locate price block for realistic hover interaction
    const priceBlock = page.locator('.price-block').first();
    await priceBlock.waitFor({ state: 'visible', timeout: revealWaitTimeout });

    const box = await priceBlock.boundingBox();
    if (!box) {
      throw new AppError('Could not obtain bounding box for .price-block', 500, 'DOM_ERROR');
    }

    // 6. Simulate realistic mouse moves across the price area (>= 8 discrete steps)
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'hover_dwell',
      detail: 'Simulating discrete human mouse trajectory & dwell (12 steps + 650ms dwell)...',
      status: 'info',
    });

    await setBanner('Simulating mouse trajectory & dwell across price area...', 'info');

    logger.debug('Simulating discrete mouse movement over price container...');
    const startX = box.x + 20;
    const startY = box.y + 20;
    await page.mouse.move(startX, startY);

    for (let step = 0; step < 12; step++) {
      const targetX = startX + step * 25 + Math.sin(step) * 5;
      const targetY = startY + ((step % 4) * 8);
      await page.mouse.move(targetX, targetY);
      await page.waitForTimeout(40);
    }

    // Wait past dwell threshold (600ms)
    await page.waitForTimeout(650);

    // 7. Poll until reveal button disabled attribute clears
    const revealBtn = page.locator('button[aria-label="Reveal price"]').first();
    await revealBtn.waitFor({ state: 'visible', timeout: revealWaitTimeout });

    let isEnabled = false;
    for (let poll = 0; poll < 25; poll++) {
      const disabledAttr = await revealBtn.getAttribute('disabled');
      if (disabledAttr === null) {
        isEnabled = true;
        break;
      }
      // Gentle jitter movements if still disabled
      await page.mouse.move(box.x + 30 + (poll % 6) * 12, box.y + 25 + (poll % 3) * 8);
      await page.waitForTimeout(100);
    }

    if (!isEnabled) {
      throw new AppError(
        'Reveal button remained disabled after mouse dwell sequence',
        504,
        'REVEAL_BUTTON_STUCK',
      );
    }

    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'button_enabled',
      detail: 'Reveal button unlocked. Executing trusted click with jitter retry...',
      status: 'info',
    });

    await setBanner('Dwell satisfied (600ms+). Clicking Reveal Price button...', 'info');

    // 8. Click reveal button with in-page retry loop (handles ~17.5% jitter click drops)
    logger.debug('Clicking reveal button with trusted Playwright event...');
    let terminalStateReached = false;
    const maxClickRetries = 5;

    for (let clickAttempt = 1; clickAttempt <= maxClickRetries; clickAttempt++) {
      try {
        await revealBtn.click({ timeout: 3000 });
      } catch {
        // Fallback to forced click if cursor was temporarily displaced
        await revealBtn.click({ force: true });
      }

      // Check for terminal state (.price-success or .price-error)
      try {
        await page.waitForSelector('.price-success, .price-error', { timeout: priceSuccessTimeout });
        terminalStateReached = true;
        break;
      } catch {
        logger.debug(
          { clickAttempt },
          'No terminal price state reached after click (likely dropped by jitter), retrying...',
        );
        await page.waitForTimeout(clickRetryWait);
      }
    }

    if (!terminalStateReached) {
      throw new AppError(
        `Price reveal sequence failed to reach terminal state after ${maxClickRetries} click attempts`,
        504,
        'REVEAL_CLICK_DROPPED',
      );
    }

    // 9. Check if container reached error state (e.g. simulated 500/503 on price endpoint or 429 rate limit)
    const errorContainer = await page.$('.price-error');
    if (errorContainer) {
      const errorText = await errorContainer.evaluate((el) => el.textContent?.trim() || '');
      const statusCode = lastNetworkError ? (lastNetworkError as { status: number }).status : 502;
      const statusDetails = lastNetworkError
        ? ` (HTTP ${(lastNetworkError as { status: number }).status} on ${(lastNetworkError as { url: string }).url})`
        : '';
      throw new AppError(
        `Price container entered error state from price endpoint: "${errorText}"${statusDetails}`,
        statusCode,
        'PRICE_ENDPOINT_ERROR',
      );
    }

    // Price successfully revealed
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'revealed',
      detail: 'Price revealed successfully (.price-success reached)',
      status: 'info',
    });

    await setBanner('Price revealed. Extracting price elements...', 'info');

    // Wait briefly for all spans and facets to settle
    await page.waitForTimeout(500);

    // 10. HONEYPOT-SAFE EXTRACTION
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'extract_dom',
      detail: 'Beginning DOM extraction across .price-main children...',
      status: 'info',
    });

    // SIMULATE MISSING: strip non-honeypot price elements after extraction begins
    if (simulate === 'missing') {
      options.onStepProgress?.({
        attempt,
        maxAttempts,
        phase: 'simulate_missing',
        detail: 'Simulating missing price element: stripping price carrier from DOM after extraction begins',
        status: 'warn',
      });
      await setBanner('SIMULATION: Stripping price carrier element from DOM...', 'warn');
      await page.evaluate(() => {
        const pm = document.querySelector('.price-main');
        if (pm) {
          const children = Array.from(pm.children);
          for (const child of children) {
            const isAriaHidden = child.getAttribute('aria-hidden') === 'true';
            const style = window.getComputedStyle(child);
            const isDisplayNone = style.display === 'none';
            const isExplicitHoneypot =
              child.classList.contains('price-value') ||
              (child as HTMLElement).dataset.price === 'true';
            if (!isAriaHidden && !isDisplayNone && !isExplicitHoneypot) {
              child.remove();
            }
          }
        }
      });
    }

    // Inspect children of .price-main directly in page context
    const extractionResult = await page.evaluate(
      ({ dynamicClass }) => {
        const pm = document.querySelector('.price-main');
        if (!pm) {
          return { error: '.price-main container not found after successful reveal' };
        }

        const honeypotValues: string[] = [];
        let realPriceRaw = '';
        let mrpRaw = '';
        let badgeRaw = '';
        const nodeSummaries: Array<{
          tagName: string;
          ariaHidden: string | null;
          display?: string;
          hasLineThrough?: boolean;
          hasChildSpans?: boolean;
          childSpanCount?: number;
          isBadge?: boolean;
          datasetPrice?: string | null;
        }> = [];

        const children = Array.from(pm.children) as HTMLElement[];

        for (const child of children) {
          const style = window.getComputedStyle(child);
          const ariaHidden = child.getAttribute('aria-hidden');
          const isDisplayNone = style.display === 'none';
          const isAriaHidden = ariaHidden === 'true';
          const isExplicitHoneypotClass = child.classList.contains('price-value');
          const isExplicitHoneypotDataset = (child as HTMLElement).dataset.price === 'true';
          const hasLineThrough =
            style.textDecoration.includes('line-through') ||
            child.classList.contains('mrp') ||
            child.className.includes('mr-');
          const isBadge =
            child.textContent?.includes('% off') ||
            child.classList.contains('badge') ||
            child.className.includes('bd-');

          const childSpans = child.querySelectorAll('span');
          const hasChildSpans = childSpans.length > 0;

          // Record node structure summary for fingerprinting
          nodeSummaries.push({
            tagName: child.tagName,
            ariaHidden,
            display: style.display,
            hasLineThrough,
            hasChildSpans,
            childSpanCount: childSpans.length,
            isBadge,
            datasetPrice: (child as HTMLElement).dataset.price || null,
          });

          // HONEYPOT DETECTION:
          // Direct siblings carrying aria-hidden="true", display:none, .price-value, or data-price="true"
          if (isAriaHidden || isDisplayNone || isExplicitHoneypotClass || isExplicitHoneypotDataset) {
            if (child.textContent) {
              honeypotValues.push(child.textContent.trim());
            }
            continue; // CRITICAL: Skip honeypot element
          }

          // STRIKETHROUGH MRP DETECTION:
          if (hasLineThrough) {
            mrpRaw = child.textContent?.trim() || '';
            continue;
          }

          // DISCOUNT BADGE DETECTION:
          if (isBadge) {
            badgeRaw = child.textContent?.trim() || '';
            continue;
          }

          // REAL PRICE CARRIER:
          // Check if matches dynamic layout class, or is the visible remaining carrier
          const matchesDynamicClass = dynamicClass && child.classList.contains(dynamicClass);
          if (matchesDynamicClass || (!realPriceRaw && hasChildSpans)) {
            // Read full textContent across all child spans (concatenates split spans & zero-width spaces)
            realPriceRaw = child.textContent || '';
          } else if (!realPriceRaw && child.textContent?.includes('₹')) {
            realPriceRaw = child.textContent || '';
          }
        }

        // Also extract stock from .stock-badge or facets
        let stockRaw = '';
        const stockBadge = document.querySelector('.stock-badge, [class*="st-"] .stock-badge');
        if (stockBadge) {
          stockRaw = stockBadge.textContent?.trim() || '';
        } else {
          const stockFacet = document.querySelector('[class*="st-"]');
          if (stockFacet) {
            stockRaw = stockFacet.textContent?.trim() || '';
          }
        }

        return {
          realPriceRaw,
          honeypotValues,
          mrpRaw,
          badgeRaw,
          stockRaw,
          nodeSummaries,
        };
      },
      { dynamicClass: dynamicPriceClass || '' },
    );

    if ('error' in extractionResult && extractionResult.error) {
      throw new AppError(extractionResult.error, 500, 'EXTRACTION_ERROR');
    }

    if (!extractionResult.realPriceRaw) {
      const fingerprint = computeStructureFingerprint(
        (extractionResult.nodeSummaries || []) as DomChildNodeSummary[],
      );
      const carrierError = new AppError(
        'Failed to extract real price carrier: no visible non-honeypot price element found in .price-main',
        500,
        'NO_PRICE_CARRIER',
      );
      (carrierError as unknown as { fingerprint: string }).fingerprint = fingerprint;
      throw carrierError;
    }

    // 11. Normalize extracted values
    const cleanedRawPrice = cleanInvisibleChars(extractionResult.realPriceRaw);
    let priceCents: number;
    try {
      priceCents = normalizePrice(extractionResult.realPriceRaw);
    } catch (normErr) {
      const rawBuf = Buffer.from(extractionResult.realPriceRaw, 'utf8');
      const hexBytes = rawBuf.toString('hex').match(/../g)?.join(' ') || '';
      logger.error(
        {
          rawPrice: extractionResult.realPriceRaw,
          utf8Hex: hexBytes,
          utf8Bytes: Array.from(rawBuf),
          cleanedPrice: cleanedRawPrice,
          error: (normErr as Error).message,
        },
        'Price normalization failed on extracted carrier string',
      );
      try {
        await page.screenshot({
          path: 'docs/RECON_VERIFICATION/price_parse_error.png',
          fullPage: true,
        });
        logger.info('Saved diagnostic screenshot to docs/RECON_VERIFICATION/price_parse_error.png');
      } catch (screenshotErr) {
        logger.warn({ error: screenshotErr }, 'Failed to capture parse error screenshot');
      }
      throw normErr;
    }

    // Normalize honeypot values so defense-in-depth can compare integer cents
    const honeypotCents: number[] = [];
    for (const hp of extractionResult.honeypotValues || []) {
      try {
        honeypotCents.push(normalizePrice(hp));
      } catch {
        // Ignore unparseable honeypot text
      }
    }

    let mrpCents: number | undefined;
    if (extractionResult.mrpRaw) {
      try {
        mrpCents = normalizePrice(extractionResult.mrpRaw);
      } catch {
        // MRP is optional
      }
    }

    // Stock fallback: if facet didn't have text, look for "In stock" on page
    let rawStock = extractionResult.stockRaw || '';
    if (!rawStock) {
      const pageStockEl = await page.$('.stock-badge, .product-stock, [data-testid="stock"]');
      if (pageStockEl) {
        rawStock = (await pageStockEl.textContent())?.trim() || '';
      }
    }
    if (!rawStock) {
      // Default to checking if "Out of stock" appears in price facets
      const facetsText = await page.locator('.price-facets').innerText().catch(() => '');
      if (facetsText.toLowerCase().includes('out of stock')) {
        rawStock = 'Out of stock';
      } else {
        rawStock = 'In Stock';
      }
    }

    const { inStock, stockText } = normalizeStock(rawStock);

    // 12. Compute structural fingerprint
    const selectorFingerprint = computeStructureFingerprint(
      (extractionResult.nodeSummaries || []) as DomChildNodeSummary[],
    );

    const formattedPrice = `₹${(priceCents / 100).toLocaleString('en-IN')}`;
    const honeypotInfo = honeypotCents.length > 0 ? ` (safely rejected ${honeypotCents.length} honeypots)` : '';
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'success',
      detail: `Extracted: ${formattedPrice} | Stock: ${inStock ? 'In Stock' : 'Out of Stock'}${honeypotInfo} | Carrier: .price-main child spans`,
      status: 'success',
    });

    await setBanner(`Extracted: ${formattedPrice} (${inStock ? 'In Stock' : 'Out of Stock'})`, 'success');

    if (!isHeadless && page && !page.isClosed()) {
      // Pause briefly in headed mode so the user/recording can observe the extracted state
      await page.waitForTimeout(1200).catch(() => {});
    }

    return {
      priceCents,
      currency: 'INR', // Target store is INR (₹)
      inStock,
      stockText,
      mrpCents,
      badgeText: extractionResult.badgeRaw || undefined,
      rawPriceText: cleanedRawPrice,
      honeypotValuesSeen: honeypotCents,
      productName,
      selectorFingerprint,
    };
  } catch (err: unknown) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    options.onStepProgress?.({
      attempt,
      maxAttempts,
      phase: 'error',
      detail: `Attempt ${attempt} error: ${errObj.message}`,
      status: 'error',
    });

    await setBanner(`Failed: ${errObj.message}`, 'error');

    if (!isHeadless && page && !page.isClosed()) {
      // Pause briefly in headed mode so the user/recording can observe the failure state
      await page.waitForTimeout(1200).catch(() => {});
    }

    throw err;
  } finally {
    // Defensive teardown — clear all route handlers before closing resources.
    // This is belt-and-suspenders: because the entire browser is closed here,
    // no handler can leak. But explicit unrouteAll() prevents any pending route
    // callbacks from firing during the brief window between page close and
    // browser close, which could otherwise log confusing errors.
    if (page) {
      try {
        if (!page.isClosed()) {
          await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
          await page.close().catch(() => {});
        }
      } catch (pageErr) {
        logger.debug({ error: pageErr }, 'Error closing page in browserFetcher finally block');
      }
    }
    if (context) {
      try {
        await context.close().catch(() => {});
      } catch (contextErr) {
        logger.debug({ error: contextErr }, 'Error closing context in browserFetcher finally block');
      }
    }
    if (browser) {
      try {
        if (browser.isConnected()) {
          await browser.close().catch(() => {});
        }
      } catch (browserErr) {
        logger.debug({ error: browserErr }, 'Error closing browser in browserFetcher finally block');
      }
    }
    page = null;
    context = null;
    browser = null;
  }
}
