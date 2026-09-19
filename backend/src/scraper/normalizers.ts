/**
 * Dedicated normalizers for raw scraped price and stock strings.
 * Enforces strict parsing and validation across all observed site formats:
 * - Plain Indian / US: "₹17,263", "$1,299.99"
 * - European decimal: "17.967,00", "€17.967,50"
 * - Trailing suffixes: "₹14,177/- (incl. of all taxes)", "₹17,263/-"
 * - Spaced thousands: "₹12 616"
 * - Lakh / Rupee notation: "Rs. 12,616.00"
 * - Split spans with zero-width / non-breaking spaces: "₹\u200B1\u200B4\u200B,\u200B1\u200B7\u200B7"
 * - Fullwidth Unicode digits (site's 'unicode' format): "₹１２,６１６" (\uFF10-\uFF19)
 * - CP437 console mojibake recovery: "Γé╣∩╝æ∩╝Æ,∩╝û∩╝æ∩╝û"
 */

// Code page 437 code points for bytes 0x80 to 0xFF (Windows console default)
const CP437_CODEPOINTS: number[] = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
  0x00ff, 0x00d6, 0x00dc, 0x00a2, 0x00a3, 0x00a5, 0x20a7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba,
  0x00bf, 0x2310, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556,
  0x2555, 0x2563, 0x2551, 0x2557, 0x255d, 0x255c, 0x255b, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567,
  0x2568, 0x2564, 0x2565, 0x2559, 0x2558, 0x2552, 0x2553, 0x256b,
  0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x03b1, 0x00df, 0x0393, 0x03c0, 0x03a3, 0x03c3, 0x00b5, 0x03c4,
  0x03a6, 0x0398, 0x03a9, 0x03b4, 0x221e, 0x03c6, 0x03b5, 0x2229,
  0x2261, 0x00b1, 0x2265, 0x2264, 0x2320, 0x2321, 0x00f7, 0x2248,
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x207f, 0x00b2, 0x25a0, 0x00a0,
];

const CP437_REV_MAP = new Map<number, number>();
for (let i = 0; i < CP437_CODEPOINTS.length; i++) {
  const cp = CP437_CODEPOINTS[i];
  if (cp !== undefined) {
    CP437_REV_MAP.set(cp, 0x80 + i);
  }
}

/**
 * Recovers true UTF-8 string if a UTF-8 character sequence was erroneously
 * captured/decoded through CP437 console mojibake (e.g. "Γé╣∩╝æ∩╝Æ,∩╝û∩╝æ∩╝û" -> "₹１２,６１６").
 */
export function tryRecoverMojibake(str: string): string {
  if (!str) return str;
  // Check for common markers of UTF-8 misdecoded as CP437:
  // \u0393\u00E9\u2563 = Γé╣ = ₹
  // \u2229\u255D = ∩╝ = \uFF00-\uFF3F fullwidth prefix
  if (/[\u0393\u2229\u255D\u2563]/.test(str)) {
    const bytes: number[] = [];
    let isAllValid = true;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code <= 0x7f) {
        bytes.push(code);
      } else {
        const b = CP437_REV_MAP.get(code);
        if (b !== undefined) {
          bytes.push(b);
        } else {
          isAllValid = false;
          break;
        }
      }
    }
    if (isAllValid && bytes.length > 0) {
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
        return decoded;
      } catch {
        // Fallback to original string if not valid UTF-8
      }
    }
  }
  return str;
}

/**
 * Strips zero-width spaces, invisible characters, and whitespace.
 */
export function cleanInvisibleChars(str: string): string {
  if (!str) return '';
  return str
    .replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F]/g, '')
    .trim();
}

/**
 * Normalizes a raw price string into integer cents (> 0).
 *
 * Handles:
 * - Plain Indian/US format: "₹17,263" -> 1726300 cents
 * - European decimal format: "17.967,00" -> 1796700 cents
 * - Trailing suffixes: "₹14,177/- (incl. of all taxes)" -> 1417700 cents
 * - Interleaved currency symbols and spaces: "₹ 14 177"
 * - Fullwidth Unicode digits: "₹１２,６１６" (\uFF10-\uFF19) -> 1261600 cents
 * - CP437 console mojibake: "Γé╣∩╝æ∩╝Æ,∩╝û∩╝æ∩╝û" -> 1261600 cents
 *
 * @param raw Raw string extracted from DOM
 * @returns Integer price in cents (strictly > 0)
 * @throws Error if the string cannot be parsed into a positive integer cents value
 */
export function normalizePrice(raw: string): number {
  if (!raw || typeof raw !== 'string') {
    throw new Error(`Cannot normalize empty or non-string price: "${raw}"`);
  }

  // 1. Recover from CP437 mojibake if terminal/encoding mismatch occurred
  let text = tryRecoverMojibake(raw);

  // 2. Unicode NFKC normalization:
  // Converts fullwidth Unicode digits (\uFF10-\uFF19: ０-９) to standard ASCII 0-9
  // Converts fullwidth punctuation (\uFF0C -> ,, \uFF0E -> ., \uFF0D -> -, etc.)
  // Converts fullwidth currency symbols (\uFFE5 -> ¥)
  text = text.normalize('NFKC');

  // Explicit defense-in-depth fullwidth digit replacement (U+FF10 - U+FF19)
  text = text.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );

  // 3. Remove zero-width spaces, non-breaking spaces, invisible control characters
  text = cleanInvisibleChars(text);

  // 4. Remove common trailing suffixes like "/- (incl. of all taxes)", "/-", "(incl. taxes)"
  text = text.replace(/\/\s*-\s*\(.*?\)/gi, '');
  text = text.replace(/\/\s*-/g, '');
  text = text.replace(/\(incl\..*?\)/gi, '');

  // Check for negative numbers before stripping non-digit characters
  if (/[-\u2212]\s*\d+/.test(text)) {
    throw new Error(`Price cannot be negative: "${raw}"`);
  }

  // 5. Remove currency symbols and word tokens (₹, $, €, £, Rs, INR, USD, EUR, etc.)
  text = text.replace(/[₹$€£]|(?:Rs\.?|INR|USD|EUR)(?!\w)/gi, '').trim();

  // 6. Remove any remaining non-digit characters except period and comma
  text = text.replace(/[^0-9.,]/g, '').trim();
  text = text.replace(/^[.,]+|[.,]+$/g, '');

  if (!text) {
    throw new Error(`Failed to extract any numeric content from price string: "${raw}"`);
  }

  let cents = 0;

  // 7. Determine separator convention
  const hasDot = text.includes('.');
  const hasComma = text.includes(',');

  if (hasDot && hasComma) {
    const firstDot = text.indexOf('.');
    const firstComma = text.indexOf(',');

    if (firstDot < firstComma) {
      // European format: "17.967,00" or "1.234.567,89"
      // Dots are thousands separators, comma is decimal
      const clean = text.replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(clean);
      cents = Math.round(parsed * 100);
    } else {
      // Standard US / UK format: "17,263.50" or "1,234,567.89"
      // Commas are thousands separators, dot is decimal
      const clean = text.replace(/,/g, '');
      const parsed = parseFloat(clean);
      cents = Math.round(parsed * 100);
    }
  } else if (hasComma && !hasDot) {
    // Only comma present
    // Could be European decimal "123,45" or Indian/US thousands "17,263" / "1,00,000"
    const parts = text.split(',');
    const lastPart = parts[parts.length - 1];

    if (parts.length === 2 && lastPart && lastPart.length === 2) {
      // e.g. "123,45" -> European decimal
      const clean = text.replace(',', '.');
      cents = Math.round(parseFloat(clean) * 100);
    } else {
      // Thousands / Lakhs separator: "17,263" or "1,00,000"
      const clean = text.replace(/,/g, '');
      const parsed = parseInt(clean, 10);
      cents = parsed * 100;
    }
  } else if (hasDot && !hasComma) {
    // Only dot present
    // Could be "17.50" (decimal) or "17.967" (European thousands)
    const parts = text.split('.');
    const lastPart = parts[parts.length - 1];

    if (parts.length === 2 && lastPart && (lastPart.length === 1 || lastPart.length === 2)) {
      // "17.5" or "17.50" -> decimal
      cents = Math.round(parseFloat(text) * 100);
    } else if (parts.length > 2) {
      // "1.234.567" -> European thousands
      const clean = text.replace(/\./g, '');
      cents = parseInt(clean, 10) * 100;
    } else {
      // Single dot with 3 digits: e.g. "17.263" - could be 17.263 dollars (fractional) or 17263
      const parsed = parseFloat(text);
      cents = Math.round(parsed * 100);
    }
  } else {
    // Plain integer without separators: "17263"
    const parsed = parseInt(text, 10);
    cents = parsed * 100;
  }

  if (isNaN(cents) || !Number.isInteger(cents) || cents <= 0) {
    throw new Error(
      `Normalized price must be an integer strictly greater than 0, parsed: ${cents} from "${raw}"`,
    );
  }

  return cents;
}

/**
 * Normalizes raw stock text into boolean inStock flag and cleaned stockText.
 *
 * Handles:
 * - "In Stock", "In stock" -> true
 * - "196 left", "Only 2 left" -> true
 * - "Out of stock", "Sold out", "Currently unavailable" -> false
 * - "0 left" -> false
 */
export function normalizeStock(raw: string): { inStock: boolean; stockText: string } {
  if (!raw || typeof raw !== 'string') {
    return { inStock: false, stockText: '' };
  }

  const cleaned = cleanInvisibleChars(raw);
  const lower = cleaned.toLowerCase();

  // Explicit out-of-stock indicators
  if (
    lower.includes('out of stock') ||
    lower.includes('sold out') ||
    lower.includes('unavailable') ||
    lower.includes('not available') ||
    lower.includes('backorder') ||
    /\b0\s*(?:left|remaining|items?)\b/i.test(lower)
  ) {
    return { inStock: false, stockText: cleaned };
  }

  // Explicit in-stock indicators
  if (
    lower.includes('in stock') ||
    lower.includes('available') ||
    /\b\d+\s*(?:left|remaining|in stock)\b/i.test(lower)
  ) {
    return { inStock: true, stockText: cleaned };
  }

  // If starts with a positive number followed by "left" or similar: "196 left"
  const numberMatch = lower.match(/^(\d+)\s*(?:left|in stock|available|items?)/);
  if (numberMatch && numberMatch[1]) {
    const qty = parseInt(numberMatch[1], 10);
    return { inStock: qty > 0, stockText: cleaned };
  }

  // Default assumption if not explicitly out of stock and text exists
  return { inStock: cleaned.length > 0, stockText: cleaned };
}
