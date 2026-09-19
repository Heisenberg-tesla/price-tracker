import { describe, it, expect } from 'vitest';
import { normalizePrice, normalizeStock, cleanInvisibleChars } from '../normalizers';

describe('Price and Stock Normalizers', () => {
  describe('normalizePrice()', () => {
    it('handles plain Indian / US format with comma thousands separators', () => {
      expect(normalizePrice('₹17,263')).toBe(1726300);
      expect(normalizePrice('₹14,177')).toBe(1417700);
      expect(normalizePrice('₹ 17,263')).toBe(1726300);
      expect(normalizePrice('17,263')).toBe(1726300);
      expect(normalizePrice('$1,299.99')).toBe(129999);
      expect(normalizePrice('14177')).toBe(1417700);
    });

    it('handles European-style decimal format (dot thousands, comma decimal)', () => {
      expect(normalizePrice('17.967,00')).toBe(1796700);
      expect(normalizePrice('€17.967,50')).toBe(1796750);
      expect(normalizePrice('1.234,56')).toBe(123456);
      expect(normalizePrice('123,45')).toBe(12345);
    });

    it('handles trailing suffixes (/- and tax disclaimers)', () => {
      expect(normalizePrice('₹14,177/- (incl. of all taxes)')).toBe(1417700);
      expect(normalizePrice('₹17,263/-')).toBe(1726300);
      expect(normalizePrice('14,177 (incl. of all taxes)')).toBe(1417700);
      expect(normalizePrice('14,177/- (incl. taxes)')).toBe(1417700);
    });

    it('strips zero-width spaces and invisible characters from carrier spans', () => {
      const obfuscated = '₹\u200B1\u200B4\u200B,\u200B1\u200B7\u200B7';
      expect(cleanInvisibleChars(obfuscated)).toBe('₹14,177');
      expect(normalizePrice(obfuscated)).toBe(1417700);

      const withNonBreakingSpaces = '₹\u00A017,263\u00A0';
      expect(normalizePrice(withNonBreakingSpaces)).toBe(1726300);
    });

    it('handles fullwidth Unicode digits (site unicode format: U+FF10-U+FF19)', () => {
      // "₹１２,６１６"
      expect(normalizePrice('₹１２,６１６')).toBe(1261600);
      // "₹１４,１７７"
      expect(normalizePrice('₹１４,１７７')).toBe(1417700);
      // "１２３４５"
      expect(normalizePrice('１２３４５')).toBe(1234500);
    });

    it('recovers from CP437 console mojibake (e.g. captured terminal string)', () => {
      // Exact captured string from product 915 scrape attempt 1
      const capturedMojibake = 'Γé╣∩╝æ∩╝Æ,∩╝û∩╝æ∩╝û';
      expect(normalizePrice(capturedMojibake)).toBe(1261600);
    });

    it('handles site bundle format variations (lakh, spaced, nbsp interleaving)', () => {
      // Lakh notation: "Rs. 12,616.00"
      expect(normalizePrice('Rs. 12,616.00')).toBe(1261600);
      expect(normalizePrice('Rs.\u00A014,177.00')).toBe(1417700);

      // Spaced format: "₹12 616"
      expect(normalizePrice('₹12 616')).toBe(1261600);

      // nbsp interleaved format: "r.split('').join('\\xA0\\u200B')"
      const interleaved = '₹\u00A0\u200B1\u00A0\u200B2\u00A0\u200B,\u00A0\u200B6\u00A0\u200B1\u00A0\u200B6';
      expect(normalizePrice(interleaved)).toBe(1261600);
    });

    it('throws on non-positive, zero, or invalid prices', () => {
      expect(() => normalizePrice('')).toThrow();
      expect(() => normalizePrice('0')).toThrow();
      expect(() => normalizePrice('₹0')).toThrow();
      expect(() => normalizePrice('-500')).toThrow();
      expect(() => normalizePrice('Free')).toThrow();
      expect(() => normalizePrice('N/A')).toThrow();
    });
  });

  describe('normalizeStock()', () => {
    it('normalizes in-stock representations', () => {
      expect(normalizeStock('In Stock')).toEqual({ inStock: true, stockText: 'In Stock' });
      expect(normalizeStock('in stock')).toEqual({ inStock: true, stockText: 'in stock' });
      expect(normalizeStock('196 left')).toEqual({ inStock: true, stockText: '196 left' });
      expect(normalizeStock('Only 2 left')).toEqual({ inStock: true, stockText: 'Only 2 left' });
      expect(normalizeStock('Available')).toEqual({ inStock: true, stockText: 'Available' });
    });

    it('normalizes out-of-stock representations', () => {
      expect(normalizeStock('Out of stock')).toEqual({ inStock: false, stockText: 'Out of stock' });
      expect(normalizeStock('Sold out')).toEqual({ inStock: false, stockText: 'Sold out' });
      expect(normalizeStock('Currently unavailable')).toEqual({ inStock: false, stockText: 'Currently unavailable' });
      expect(normalizeStock('0 left')).toEqual({ inStock: false, stockText: '0 left' });
    });
  });
});
