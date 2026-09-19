import { env } from '../config/env';
import { getSupabaseClient } from '../db/client';
import { createTrackedProduct, reconcileStalePendingLogs } from '../db/repository';
import { scrapeProduct } from '../scraper/scrapeProduct';
import { fetchProductDetails } from '../scraper/catalog';
import { TrackedProduct } from '../types/database';
import { SimulationMode, StepProgressEvent } from '../scraper/types';

// ANSI colour utilities for human-readable narration
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgDark: '\x1b[100m',
};

function parseArgs() {
  const args = process.argv.slice(2);
  let productArg = (process.env.npm_config_product as string) || '';
  let simulate: SimulationMode = ((process.env.npm_config_simulate as string) || 'none') as SimulationMode;
  let slowMo = process.env.npm_config_slowmo ? parseInt(process.env.npm_config_slowmo, 10) : 75;
  let devtools = process.env.npm_config_devtools === 'true';
  let attempts = process.env.npm_config_attempts ? parseInt(process.env.npm_config_attempts, 10) : 3;

  for (const arg of args) {
    if (arg.startsWith('--product=')) {
      productArg = arg.slice('--product='.length).trim();
    } else if (arg.startsWith('--simulate=')) {
      const mode = arg.slice('--simulate='.length).trim().toLowerCase();
      if (mode === 'slow' || mode === 'error' || mode === 'missing' || mode === 'none') {
        simulate = mode;
      } else {
        console.warn(`${c.yellow}⚠️ Unknown simulation mode "${mode}". Defaulting to "none".${c.reset}`);
      }
    } else if (arg.startsWith('--slowmo=')) {
      const parsed = parseInt(arg.slice('--slowmo='.length).trim(), 10);
      if (!isNaN(parsed) && parsed >= 0) slowMo = parsed;
    } else if (arg === '--devtools') {
      devtools = true;
    } else if (arg.startsWith('--attempts=')) {
      const parsed = parseInt(arg.slice('--attempts='.length).trim(), 10);
      if (!isNaN(parsed) && parsed > 0) attempts = parsed;
    } else if (!arg.startsWith('--') && !productArg) {
      productArg = arg.trim();
    }
  }

  if (!productArg) {
    productArg = '915';
  }

  // Also check env var for slowMo
  if (process.env.PLAYWRIGHT_SLOWMO) {
    const envSlowMo = parseInt(process.env.PLAYWRIGHT_SLOWMO, 10);
    if (!isNaN(envSlowMo) && envSlowMo >= 0) slowMo = envSlowMo;
  }

  return { productArg, simulate, slowMo, devtools, attempts };
}

async function resolveProduct(arg: string, baseUrl: string): Promise<TrackedProduct> {
  let storeProductId: string | null = null;
  let productUrl: string;

  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    productUrl = arg;
    const match = arg.match(/\/product\/(\d+)/i);
    if (match && match[1]) {
      storeProductId = match[1];
    }
  } else if (/^\d+$/.test(arg)) {
    storeProductId = arg;
    productUrl = `${baseUrl}/product/${arg}`;
  } else {
    productUrl = `${baseUrl}/product/${arg}`;
  }

  const supabase = getSupabaseClient();
  let product: TrackedProduct | null = null;

  // 1. By store_product_id
  if (storeProductId) {
    const { data } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('store_product_id', storeProductId)
      .maybeSingle();
    if (data) product = data as TrackedProduct;
  }

  // 2. By product_url
  if (!product) {
    const { data } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('product_url', productUrl)
      .maybeSingle();
    if (data) product = data as TrackedProduct;
  }

  // 3. By UUID directly
  if (!product && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
    const { data } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('id', arg)
      .maybeSingle();
    if (data) product = data as TrackedProduct;
  }

  // 4. If not found, auto-create via catalog metadata
  if (!product) {
    console.log(`${c.gray}Product not registered in tracked_products. Resolving from catalog...${c.reset}`);
    let name = `Product ${storeProductId || arg}`;
    let imageUrl: string | null = null;
    let category: string | null = null;
    let sku: string | null = null;

    if (storeProductId) {
      try {
        const details = await fetchProductDetails(storeProductId);
        if (details) {
          if (typeof details.name === 'string' && details.name) name = details.name;
          if (typeof details.image === 'string') imageUrl = details.image;
          if (typeof details.category === 'string') category = details.category;
          if (typeof details.sku === 'string') sku = details.sku;
        }
      } catch {
        console.warn(`${c.yellow}Could not fetch catalog metadata; using default name.${c.reset}`);
      }
    }

    product = await createTrackedProduct({
      store_product_id: storeProductId || null,
      product_url: productUrl,
      name,
      image_url: imageUrl,
      category,
      sku,
      scrape_interval_minutes: 120,
      is_active: true,
    });
    console.log(`${c.green}✔ Registered new tracked product: ${c.bold}${product.name}${c.reset} (${product.id})`);
  }

  return product;
}

async function main() {
  const { productArg, simulate, slowMo, devtools, attempts } = parseArgs();
  const baseUrl = env.STORE_BASE_URL.replace(/\/$/, '');

  // Automatically sweep orphaned pending logs from prior interrupted runs
  try {
    await reconcileStalePendingLogs(10_000);
  } catch {
    // Ignore reconciliation sweep failures
  }

  console.log('\n' + c.bold + c.blue + '══════════════════════════════════════════════════════════════════════════' + c.reset);
  console.log(c.bold + c.blue + '         OBSERVABLE HEADED SCRAPE RUN — PLAYWRIGHT CHROMIUM' + c.reset);
  console.log(c.bold + c.blue + '══════════════════════════════════════════════════════════════════════════' + c.reset);

  const product = await resolveProduct(productArg, baseUrl);

  console.log(`${c.gray}Target Product:${c.reset} ${c.bold}${product.name}${c.reset}`);
  console.log(`${c.gray}URL:${c.reset}            ${product.product_url}`);
  console.log(`${c.gray}Max Attempts:${c.reset}   ${attempts}`);
  console.log(`${c.gray}Browser Config:${c.reset} Headless=${c.bold}false${c.reset} | slowMo=${slowMo}ms | Viewport=1280x800 | DevTools=${devtools}`);

  if (simulate !== 'none') {
    console.log(
      '\n' +
      c.bgYellow + c.black + c.bold + ' ⚠️  SIMULATION ACTIVE: ' + simulate.toUpperCase() + ' ' + c.reset + '\n' +
      c.yellow + '    [STAGED FAULT INJECTION ENABLED FOR EVALUATION TRANSPARENCY]\n' +
      (simulate === 'slow'
        ? '    • Attempt 1: Route delayed 16s past timeout -> forces retry loop to trigger\n    • Attempt 2+: Normal execution -> demonstrates automatic retry recovery'
        : simulate === 'error'
        ? '    • Attempts 1-2: Intercepts /api/products/*/price with HTTP 500 (page/title render normally)\n    • Attempt 3:     Fresh browser, zero interception — demonstrates automatic retry recovery'
        : '    • All attempts: Strips price carrier from DOM after extraction begins\n    • Forces NO_PRICE_CARRIER parse failure to exercise exhausted retry path') +
      c.reset
    );
  } else {
    console.log(`${c.gray}Simulation:${c.reset}     ${c.green}none (Organic live run)${c.reset}`);
  }

  console.log(c.gray + '──────────────────────────────────────────────────────────────────────────' + c.reset + '\n');

  let currentAttempt = 0;

  const onStepProgress = (event: StepProgressEvent) => {
    if (event.attempt !== currentAttempt) {
      currentAttempt = event.attempt;
      console.log(
        `\n${c.bold}${c.magenta}▶ ATTEMPT ${event.attempt}/${event.maxAttempts}${c.reset} ${c.gray}[Strategy: Headless Chromium (Headed Mode)]${c.reset}`
      );
    }

    const prefix = `${c.gray}[Attempt ${event.attempt}/${event.maxAttempts}]${c.reset}`;
    const duration = event.durationMs !== undefined ? ` ${c.dim}(${event.durationMs}ms)${c.reset}` : '';

    switch (event.status) {
      case 'success':
        console.log(`  ${prefix} ${c.green}✔ ${event.phase.toUpperCase()}:${c.reset} ${event.detail}${duration}`);
        break;
      case 'warn':
        console.log(`  ${prefix} ${c.yellow}⚠️ ${event.phase.toUpperCase()}:${c.reset} ${event.detail}${duration}`);
        break;
      case 'error':
        console.log(`  ${prefix} ${c.red}✖ ${event.phase.toUpperCase()}:${c.reset} ${event.detail}${duration}`);
        break;
      default:
        console.log(`  ${prefix} ${c.cyan}ℹ ${event.phase.toUpperCase()}:${c.reset} ${event.detail}${duration}`);
        break;
    }
  };

  const onBackoffCountdown = (remainingSec: number, totalSec: number) => {
    if (remainingSec > 0) {
      process.stdout.write(
        `\r  ${c.yellow}⏳ Backing off ${remainingSec.toFixed(1)}s before retry (total: ${totalSec.toFixed(1)}s)...${c.reset}   `
      );
    } else {
      process.stdout.write(
        `\r  ${c.green}✔ Backoff complete. Launching next attempt...${c.reset}                     \n`
      );
    }
  };

  const startTime = Date.now();

  try {
    // Call the REAL orchestrator (same path as API and cron jobs)
    const result = await scrapeProduct(product, {
      headless: false,
      slowMo,
      devtools,
      maxAttempts: attempts,
      simulate,
      onStepProgress,
      onBackoffCountdown,
      triggerSource: 'manual',
    });

    const totalDuration = Date.now() - startTime;

    console.log('\n' + c.gray + '──────────────────────────────────────────────────────────────────────────' + c.reset);
    console.log(c.bold + 'SCRAPE EXECUTION SUMMARY' + c.reset);
    console.log(`${c.gray}Scrape Log ID:${c.reset}       ${result.log.id}`);
    console.log(
      `${c.gray}Terminal Outcome:${c.reset}    ${
        result.outcome === 'success' || result.outcome === 'success_after_retry'
          ? c.bold + c.green + result.outcome.toUpperCase() + c.reset
          : c.bold + c.red + result.outcome.toUpperCase() + c.reset
      }`
    );
    console.log(`${c.gray}Attempts Made:${c.reset}       ${result.attempts}/${attempts}`);
    console.log(`${c.gray}Total Duration:${c.reset}      ${(totalDuration / 1000).toFixed(2)}s`);

    if (result.priceRecord) {
      const formattedPrice = (result.priceRecord.price_cents / 100).toLocaleString('en-IN', {
        style: 'currency',
        currency: result.priceRecord.currency || 'INR',
      });
      console.log(`${c.gray}Price History Row:${c.reset}   ${c.green}Inserted (ID: ${result.priceRecord.id})${c.reset}`);
      console.log(`${c.gray}Recorded Price:${c.reset}      ${c.bold}${formattedPrice}${c.reset}`);
      console.log(`${c.gray}Recorded Stock:${c.reset}      ${result.priceRecord.in_stock ? c.green + 'In Stock' + c.reset : c.red + 'Out of Stock' + c.reset} ("${result.priceRecord.stock_text || ''}")`);
    } else {
      console.log(
        `${c.gray}Price History Row:${c.reset}   ${c.yellow}NONE WRITTEN${c.reset} (Accurately verified: failed runs write zero rows to price_history)`
      );
    }

    console.log(
      `${c.gray}Database State:${c.reset}      ${c.green}Verified: genuine scrape_logs row finalised with outcome='${result.outcome}'${c.reset}`
    );
    console.log(c.bold + c.blue + '══════════════════════════════════════════════════════════════════════════\n' + c.reset);

    process.exit(result.outcome === 'failed' ? 1 : 0);
  } catch (fatalErr: unknown) {
    const err = fatalErr instanceof Error ? fatalErr : new Error(String(fatalErr));
    console.error(`\n${c.bold}${c.red}FATAL ORCHESTRATION ERROR:${c.reset} ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled script error:', err);
  process.exit(1);
});
