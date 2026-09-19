import { AppError } from '../lib/errors';
import { ScrapedPriceData } from './types';

/**
 * Dedicated error thrown when scraped data fails strict validation gates.
 */
export class ValidationError extends AppError {
  constructor(message: string, public readonly validationCode: string) {
    super(message, 422, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Calculates token overlap similarity between two strings (0 to 1).
 */
export function fuzzyStringMatch(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

  const tokens1 = clean(str1);
  const tokens2 = clean(str2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  let intersection = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersection++;
    }
  }

  const union = new Set([...tokens1, ...tokens2]).size;
  return intersection / union;
}

/**
 * Validates a scrape result against all non-negotiable rules:
 * 1. price_cents is a positive integer in a sane range (0 < price < 100,000,000 cents)
 * 2. price is not null, NaN, 0, or empty
 * 3. stock was actually found and non-empty (not defaulted)
 * 4. product name on page matches expected product name (if provided) via fuzzy match
 * 5. extracted price does NOT equal any known honeypot value seen on the same page load
 *
 * @throws ValidationError if any rule is violated
 */
export function validateScrapeResult(
  data: ScrapedPriceData,
  expectedProductName?: string,
): void {
  // 1 & 2: Price must be a valid positive integer in sane range
  if (
    typeof data.priceCents !== 'number' ||
    isNaN(data.priceCents) ||
    !Number.isInteger(data.priceCents) ||
    data.priceCents <= 0
  ) {
    throw new ValidationError(
      `Price validation failed: price_cents must be an integer strictly > 0. Received: ${data.priceCents}`,
      'INVALID_PRICE',
    );
  }

  const MAX_SANE_PRICE_CENTS = 100_000_000; // $1,000,000 or ₹1,00,00,000
  if (data.priceCents > MAX_SANE_PRICE_CENTS) {
    throw new ValidationError(
      `Price validation failed: price_cents exceeds sanity threshold of ${MAX_SANE_PRICE_CENTS}. Received: ${data.priceCents}`,
      'PRICE_OUT_OF_RANGE',
    );
  }

  // 3: Stock text must be non-empty and actually extracted from DOM
  if (
    typeof data.inStock !== 'boolean' ||
    !data.stockText ||
    data.stockText.trim().length === 0
  ) {
    throw new ValidationError(
      `Stock validation failed: in_stock must be boolean and stock_text must be non-empty. Received inStock=${data.inStock}, stockText="${data.stockText}"`,
      'MISSING_STOCK',
    );
  }

  // 4: Product name sanity & fuzzy match
  if (!data.productName || data.productName.trim().length === 0) {
    throw new ValidationError(
      'Product name validation failed: page product title was empty or not found',
      'MISSING_PRODUCT_NAME',
    );
  }

  if (expectedProductName && expectedProductName.trim().length > 0) {
    const similarity = fuzzyStringMatch(data.productName, expectedProductName);
    const isSubstring =
      data.productName.toLowerCase().includes(expectedProductName.toLowerCase()) ||
      expectedProductName.toLowerCase().includes(data.productName.toLowerCase());

    // Accept if either contains the other or token overlap is >= 0.3
    if (!isSubstring && similarity < 0.3) {
      throw new ValidationError(
        `Product name mismatch (navigation drift detected): expected "${expectedProductName}", got "${data.productName}" (similarity: ${similarity.toFixed(2)})`,
        'PRODUCT_NAME_MISMATCH',
      );
    }
  }

  // 5: Defense-in-depth: extracted price must NOT match any honeypot price found on page
  if (
    data.honeypotValuesSeen &&
    data.honeypotValuesSeen.length > 0 &&
    data.honeypotValuesSeen.includes(data.priceCents)
  ) {
    throw new ValidationError(
      `Defense-in-depth triggered: extracted price ${data.priceCents} matches a known honeypot element value on the page (${data.honeypotValuesSeen.join(', ')})`,
      'HONEYPOT_COLLISION',
    );
  }
}
