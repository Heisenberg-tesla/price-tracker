/* eslint-disable no-irregular-whitespace */
import { describe, it, expect } from 'vitest';
import { validateScrapeResult, ValidationError } from '../validate';
import { normalizePrice, cleanInvisibleChars } from '../normalizers';
import { ScrapedPriceData } from '../types';

/**
 * Realistic DOM fixture matching verified live DOM from docs/RECON_VERIFICATION/price_main_after.html
 */
const LIVE_VERIFIED_PRICE_MAIN_HTML = `
<div class="price-main">
  <span class="price-value" aria-hidden="true" style="display: none;">₹10,115</span>
  <span class="mr-k2" style="text-decoration: line-through; opacity: 0.55; margin-right: 10px;">₹17,721</span>
  <div class="voxrnj6 pv-k2" style="font-family: var(--serif); font-size: 2.4rem; font-weight: 700; letter-spacing: -0.02em; opacity: 1;">
    <span>₹​</span><span>1​</span><span>4​</span><span>,​</span><span>1​</span><span>7​</span><span>7</span>
  </div>
  <span class="bd-k2" style="margin-left: 10px; color: rgb(47, 133, 90); font-weight: 600;">20% off</span>
  <span class="amount" data-price="true" aria-hidden="true" style="display: none;">₹11,999</span>
</div>
`;

/**
 * Pure DOM extraction simulation mirroring the in-page logic in browserFetcher.ts
 */
function extractFromFixture(html: string) {
  // Strip outer .price-main wrapper to access direct children only
  const innerHtml = html
    .replace(/^\s*<div[^>]*class="price-main"[^>]*>/i, '')
    .replace(/<\/div>\s*$/i, '')
    .trim();

  // Match direct children of .price-main
  const childRegex = /<(span|div)([^>]*)>([\s\S]*?)<\/\1>/gi;
  const honeypotValues: number[] = [];
  let realPriceRaw = '';
  let mrpRaw = '';
  let badgeRaw = '';

  let match: RegExpExecArray | null;
  while ((match = childRegex.exec(innerHtml)) !== null) {
    const tagName = match[1] || '';
    const attrs = match[2] || '';
    const innerContent = match[3] || '';
    const isAriaHidden = attrs.includes('aria-hidden="true"');
    const isDisplayNone = attrs.includes('display: none');
    const isPriceValue = attrs.includes('price-value');
    const isDataPrice = attrs.includes('data-price="true"');
    const isStrike = attrs.includes('line-through') || attrs.includes('mr-');
    const isBadge = attrs.includes('bd-') || innerContent.includes('% off');

    // Honeypot sibling exclusion
    if (isAriaHidden || isDisplayNone || isPriceValue || isDataPrice) {
      const text = innerContent.replace(/<[^>]+>/g, '').trim();
      try {
        honeypotValues.push(normalizePrice(text));
      } catch {
        // ignore
      }
      continue;
    }

    // MRP
    if (isStrike) {
      mrpRaw = innerContent.replace(/<[^>]+>/g, '').trim();
      continue;
    }

    // Badge
    if (isBadge) {
      badgeRaw = innerContent.replace(/<[^>]+>/g, '').trim();
      continue;
    }

    // Real price carrier
    if (tagName.toLowerCase() === 'div' || innerContent.includes('₹')) {
      realPriceRaw = innerContent.replace(/<[^>]+>/g, '');
    }
  }

  const cleaned = cleanInvisibleChars(realPriceRaw);
  return {
    priceCents: normalizePrice(cleaned),
    honeypotValues,
    mrpCents: mrpRaw ? normalizePrice(mrpRaw) : undefined,
    badgeText: badgeRaw,
  };
}

describe('Honeypot Exclusion and Validation Layer', () => {
  it('correctly ignores both honeypot siblings and extracts the real obfuscated price', () => {
    const extracted = extractFromFixture(LIVE_VERIFIED_PRICE_MAIN_HTML);

    // Assert honeypots were identified and excluded from real price
    expect(extracted.honeypotValues).toEqual([1011500, 1199900]);

    // Assert real price is the concatenated obfuscated carrier (₹14,177)
    expect(extracted.priceCents).toBe(1417700);

    // Assert MRP and badge
    expect(extracted.mrpCents).toBe(1772100);
    expect(extracted.badgeText).toBe('20% off');
  });

  it('validates a correct scrape result against validation gates', () => {
    const validData: ScrapedPriceData = {
      priceCents: 1417700,
      currency: 'INR',
      inStock: true,
      stockText: 'In Stock',
      productName: 'Ironwood Trackpad Studio',
      rawPriceText: '₹14,177',
      honeypotValuesSeen: [1011500, 1199900],
      selectorFingerprint: 'PRICE_MAIN_VALID',
    };

    expect(() => validateScrapeResult(validData, 'Ironwood Trackpad Studio')).not.toThrow();
  });

  it('triggers defense-in-depth ValidationError if extracted price matches a honeypot value', () => {
    const compromisedData: ScrapedPriceData = {
      priceCents: 1011500, // Matches Honeypot 1!
      currency: 'INR',
      inStock: true,
      stockText: 'In Stock',
      productName: 'Ironwood Trackpad Studio',
      rawPriceText: '₹10,115',
      honeypotValuesSeen: [1011500, 1199900],
      selectorFingerprint: 'PRICE_MAIN_VALID',
    };

    expect(() => validateScrapeResult(compromisedData, 'Ironwood Trackpad Studio')).toThrowError(
      ValidationError,
    );

    try {
      validateScrapeResult(compromisedData, 'Ironwood Trackpad Studio');
    } catch (e) {
      expect((e as ValidationError).validationCode).toBe('HONEYPOT_COLLISION');
    }
  });

  it('rejects navigation drift when product name does not match expected product', () => {
    const driftedData: ScrapedPriceData = {
      priceCents: 1417700,
      currency: 'INR',
      inStock: true,
      stockText: 'In Stock',
      productName: 'Completely Different Gaming Keyboard',
      rawPriceText: '₹14,177',
      honeypotValuesSeen: [1011500, 1199900],
      selectorFingerprint: 'PRICE_MAIN_VALID',
    };

    expect(() => validateScrapeResult(driftedData, 'Ironwood Trackpad Studio')).toThrowError(
      ValidationError,
    );

    try {
      validateScrapeResult(driftedData, 'Ironwood Trackpad Studio');
    } catch (e) {
      expect((e as ValidationError).validationCode).toBe('PRODUCT_NAME_MISMATCH');
    }
  });

  it('rejects invalid or missing price/stock', () => {
    const invalidPrice: ScrapedPriceData = {
      priceCents: 0,
      currency: 'INR',
      inStock: true,
      stockText: 'In Stock',
      productName: 'Ironwood Trackpad Studio',
      rawPriceText: '0',
      honeypotValuesSeen: [],
      selectorFingerprint: 'PRICE_MAIN_VALID',
    };
    expect(() => validateScrapeResult(invalidPrice)).toThrowError(ValidationError);

    const missingStock: ScrapedPriceData = {
      priceCents: 1417700,
      currency: 'INR',
      inStock: true,
      stockText: '',
      productName: 'Ironwood Trackpad Studio',
      rawPriceText: '₹14,177',
      honeypotValuesSeen: [],
      selectorFingerprint: 'PRICE_MAIN_VALID',
    };
    expect(() => validateScrapeResult(missingStock)).toThrowError(ValidationError);
  });
});
