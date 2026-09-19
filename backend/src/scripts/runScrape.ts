import { env } from '../config/env';
import { getSupabaseClient } from '../db/client';
import { createTrackedProduct } from '../db/repository';
import { scrapeProduct } from '../scraper/scrapeProduct';
import { fetchProductDetails } from '../scraper/catalog';
import { TrackedProduct } from '../types/database';

async function main() {
  const arg = process.argv[2]?.trim() || '915';
  const baseUrl = env.STORE_BASE_URL.replace(/\/$/, '');

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
    // Might be a raw slug or UUID
    productUrl = `${baseUrl}/product/${arg}`;
  }

  const supabase = getSupabaseClient();
  let product: TrackedProduct | null = null;

  // 1. Try finding by store_product_id if available
  if (storeProductId) {
    const { data } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('store_product_id', storeProductId)
      .maybeSingle();
    if (data) product = data as TrackedProduct;
  }

  // 2. Try finding by product_url
  if (!product) {
    const { data } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('product_url', productUrl)
      .maybeSingle();
    if (data) product = data as TrackedProduct;
  }

  // 3. Try finding by UUID directly (if arg is a UUID)
  if (!product && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg)) {
    const { data } = await supabase
      .from('tracked_products')
      .select('*')
      .eq('id', arg)
      .maybeSingle();
    if (data) product = data as TrackedProduct;
  }

  // 4. If not found, create a new tracked_products row
  if (!product) {
    console.log(`[runScrape] Product not found in database. Preparing new tracked_products record...`);
    let name = `Product ${storeProductId || arg}`;
    let imageUrl: string | null = null;
    let category: string | null = null;
    let sku: string | null = null;

    if (storeProductId) {
      try {
        console.log(`[runScrape] Fetching catalog details from /api/product/${storeProductId}...`);
        const details = await fetchProductDetails(storeProductId);
        if (details) {
          if (typeof details.name === 'string' && details.name) name = details.name;
          if (typeof details.image === 'string') imageUrl = details.image;
          if (typeof details.category === 'string') category = details.category;
          if (typeof details.sku === 'string') sku = details.sku;
          console.log(`[runScrape] Retrieved metadata: "${name}" (${category || 'General'})`);
        }
      } catch (err) {
        console.warn(`[runScrape] Could not fetch catalog metadata, using fallback name:`, err);
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
    console.log(`[runScrape] Created tracked product record: ${product.id}`);
  } else {
    console.log(`[runScrape] Found existing tracked product: ${product.id} ("${product.name}")`);
  }

  console.log(`\n======================================================`);
  console.log(`[runScrape] Triggering VISIBLE browser scrape:`);
  console.log(`  - Tracked Product ID: ${product.id}`);
  console.log(`  - Store Product ID:   ${product.store_product_id || 'N/A'}`);
  console.log(`  - Product Name:       ${product.name}`);
  console.log(`  - Product URL:        ${product.product_url}`);
  console.log(`  - Headless Mode:      false (Visible Chromium window)`);
  console.log(`======================================================\n`);

  const startTime = Date.now();
  const result = await scrapeProduct(product, {
    triggerSource: 'manual',
    headless: false, // Explicitly force visible browser window
  });
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n======================================================`);
  console.log(`[runScrape] Scrape Completed in ${durationSec}s`);
  console.log(`  - Final Outcome:      ${result.outcome.toUpperCase()}`);
  console.log(`  - Total Attempts:     ${result.attempts}`);
  console.log(`  - Scrape Log ID:      ${result.log.id}`);

  if (result.priceRecord) {
    const formattedPrice = (result.priceRecord.price_cents / 100).toLocaleString('en-IN', {
      style: 'currency',
      currency: result.priceRecord.currency || 'INR',
    });
    console.log(`  - Price Recorded:     ${formattedPrice} (${result.priceRecord.price_cents} cents)`);
    console.log(`  - Stock Status:       ${result.priceRecord.in_stock ? 'IN STOCK' : 'OUT OF STOCK'}`);
    console.log(`  - Raw Stock Text:     "${result.priceRecord.stock_text || ''}"`);
    console.log(`  - Price History ID:   ${result.priceRecord.id}`);
  } else {
    console.log(`  - No price record created (outcome: ${result.outcome})`);
  }
  console.log(`======================================================\n`);

  process.exit(result.outcome === 'failed' ? 1 : 0);
}

main().catch((err) => {
  console.error('[runScrape] Uncaught execution failure:', err);
  process.exit(1);
});
