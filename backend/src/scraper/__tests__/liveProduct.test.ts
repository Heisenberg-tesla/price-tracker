import { describe, it, expect } from 'vitest';
import { fetchPriceWithBrowser } from '../browserFetcher';
import { validateScrapeResult } from '../validate';

const isLiveEnabled = process.env.RUN_LIVE_TESTS === 'true';

describe('Live Product Integration Test (Product 915)', () => {
  it.skipIf(!isLiveEnabled)(
    'scrapes, reveals, extracts and validates live product 915',
    async () => {
      const url = 'https://demo.inelabteamdev.com/product/915';
      const result = await fetchPriceWithBrowser({
        productUrl: url,
        headless: true,
        timeoutMs: 40000,
      });

      // 1. Assert extracted price is positive integer cents in a realistic range
      expect(typeof result.priceCents).toBe('number');
      expect(Number.isInteger(result.priceCents)).toBe(true);
      expect(result.priceCents).toBeGreaterThan(100000); // Greater than ₹1,000
      expect(result.priceCents).toBeLessThan(10000000); // Less than ₹1,00,000

      // 2. Assert currency and stock
      expect(result.currency).toBe('INR');
      expect(typeof result.inStock).toBe('boolean');
      expect(result.stockText).toBeTruthy();

      // 3. Assert product name
      expect(result.productName.toLowerCase()).toContain('ironwood');

      // 4. Assert honeypots were identified and excluded
      expect(result.honeypotValuesSeen.length).toBeGreaterThanOrEqual(1);
      expect(result.honeypotValuesSeen).not.toContain(result.priceCents);

      // 5. Run full validation layer check
      expect(() => validateScrapeResult(result, 'Ironwood Trackpad Studio')).not.toThrow();
    },
    45000,
  );
});
