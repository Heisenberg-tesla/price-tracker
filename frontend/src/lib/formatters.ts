/**
 * Currency, Timestamp, and Metric Formatters
 * Strict integer arithmetic: NEVER float math in the UI.
 */

/**
 * Formats integer cents into a localized currency string without floating point arithmetic.
 *
 * @param cents Integer cents (e.g. 1417700 for ₹14,177.00)
 * @param currency ISO 4217 Currency Code (default: 'USD')
 */
export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return '—';
  }

  const isNegative = cents < 0;
  const absCents = Math.abs(Math.round(cents));
  const wholeUnits = Math.floor(absCents / 100);
  const remainderCents = absCents % 100;
  const decimalPart = remainderCents.toString().padStart(2, '0');

  const upperCurrency = currency.toUpperCase();
  let symbol = '$';
  let locale = 'en-US';

  switch (upperCurrency) {
    case 'INR':
      symbol = '₹';
      locale = 'en-IN';
      break;
    case 'EUR':
      symbol = '€';
      locale = 'de-DE';
      break;
    case 'GBP':
      symbol = '£';
      locale = 'en-GB';
      break;
    case 'JPY':
      symbol = '¥';
      locale = 'ja-JP';
      break;
    case 'USD':
    default:
      symbol = '$';
      locale = 'en-US';
      break;
  }

  const formattedWhole = wholeUnits.toLocaleString(locale);
  const formatted = `${symbol}${formattedWhole}.${decimalPart}`;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Formats a timestamp into a human-friendly relative time ("3m ago", "2h ago", "yesterday").
 */
export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'Never';

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (isNaN(diffMs)) return 'Invalid date';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 15) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;

  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Formats an ISO date into user's local timezone with full precision for hover tooltips.
 */
export function formatAbsoluteDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'Never';

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'Invalid date';

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Formats duration in milliseconds to human-readable string.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';

  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
