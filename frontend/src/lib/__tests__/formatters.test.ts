import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatRelativeTime,
  formatAbsoluteDateTime,
  formatDuration,
} from '../formatters';

describe('formatters utility suite', () => {
  describe('formatMoney', () => {
    it('formats integer cents to INR currency with Indian grouping and decimal cents', () => {
      expect(formatMoney(1417700, 'INR')).toBe('₹14,177.00');
      expect(formatMoney(1261600, 'INR')).toBe('₹12,616.00');
    });

    it('formats standard USD integer cents accurately', () => {
      expect(formatMoney(1999, 'USD')).toBe('$19.99');
      expect(formatMoney(100000, 'USD')).toBe('$1,000.00');
    });

    it('formats European EUR integer cents', () => {
      expect(formatMoney(4999, 'EUR')).toBe('€49.99');
    });

    it('formats zero cents properly', () => {
      expect(formatMoney(0, 'USD')).toBe('$0.00');
      expect(formatMoney(0, 'INR')).toBe('₹0.00');
    });

    it('formats negative cents properly without float distortion', () => {
      expect(formatMoney(-550, 'USD')).toBe('-$5.50');
    });

    it('returns a neutral dash when cents is null, undefined, or NaN', () => {
      expect(formatMoney(null)).toBe('—');
      expect(formatMoney(undefined)).toBe('—');
      expect(formatMoney(NaN)).toBe('—');
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "Never" for null or undefined timestamps', () => {
      expect(formatRelativeTime(null)).toBe('Never');
      expect(formatRelativeTime(undefined)).toBe('Never');
    });

    it('formats recent timestamps into relative intervals', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now - 5000))).toBe('just now');
      expect(formatRelativeTime(new Date(now - 45000))).toBe('45s ago');
      expect(formatRelativeTime(new Date(now - 12 * 60 * 1000))).toBe('12m ago');
      expect(formatRelativeTime(new Date(now - 3 * 60 * 60 * 1000))).toBe('3h ago');
    });
  });

  describe('formatAbsoluteDateTime', () => {
    it('returns "Never" for empty dates', () => {
      expect(formatAbsoluteDateTime(null)).toBe('Never');
    });

    it('formats valid ISO date strings into local representations', () => {
      const formatted = formatAbsoluteDateTime('2026-09-19T10:00:00.000Z');
      expect(formatted).not.toBe('Invalid date');
      expect(formatted).not.toBe('Never');
      expect(typeof formatted).toBe('string');
    });
  });

  describe('formatDuration', () => {
    it('formats milliseconds and seconds cleanly', () => {
      expect(formatDuration(null)).toBe('—');
      expect(formatDuration(450)).toBe('450ms');
      expect(formatDuration(3500)).toBe('3.5s');
      expect(formatDuration(75000)).toBe('1m 15s');
    });
  });
});
