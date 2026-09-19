import crypto from 'crypto';
import { getSupabaseClient } from '../db/client';
import { logger } from '../lib/logger';

export interface DomChildNodeSummary {
  tagName: string;
  ariaHidden: string | null;
  display?: string;
  hasLineThrough?: boolean;
  hasChildSpans?: boolean;
  childSpanCount?: number;
  isBadge?: boolean;
  datasetPrice?: string | null;
}

/**
 * Computes a deterministic structural fingerprint for the price container DOM shape.
 *
 * Rules:
 * - Based strictly on tag names, child hierarchy, relative sibling structure,
 *   presence of aria-hidden, display:none, and inline strikethrough.
 * - Explicitly IGNORES rotating CSS class names (e.g. pv-k2, voxrnj6) to avoid
 *   false positives on normal layout rotation.
 */
export function computeStructureFingerprint(nodes: DomChildNodeSummary[]): string {
  const nodeSignatures = nodes.map((n, idx) => {
    const parts: string[] = [n.tagName.toUpperCase()];

    if (n.ariaHidden === 'true') {
      parts.push('aria-hidden');
    }
    if (n.display === 'none') {
      parts.push('display-none');
    }
    if (n.hasLineThrough) {
      parts.push('strike');
    }
    if (n.isBadge) {
      parts.push('badge');
    }
    if (n.hasChildSpans) {
      parts.push('split-spans');
    }
    if (n.datasetPrice === 'true') {
      parts.push('data-price');
    }

    return `${idx}:${parts.join(':')}`;
  });

  const rawStructure = `PRICE_MAIN[${nodeSignatures.join(';')}]`;
  const hash = crypto.createHash('sha256').update(rawStructure).digest('hex').substring(0, 16);

  return `${rawStructure}#${hash}`;
}

/**
 * Checks if the structure has changed compared to the last recorded snapshot for this product,
 * and logs/records changes.
 */
export async function recordStructureSnapshot(
  productId: string,
  fingerprint: string,
): Promise<{ changed: boolean; previousFingerprint: string | null }> {
  try {
    const supabase = getSupabaseClient();

    // Fetch the latest snapshot for this product
    const { data: latest, error: fetchErr } = await supabase
      .from('structure_snapshots')
      .select('selector_fingerprint')
      .eq('product_id', productId)
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) {
      logger.warn({ error: fetchErr, productId }, 'Failed to fetch previous structure snapshot');
    }

    const previousFingerprint = latest ? latest.selector_fingerprint : null;
    const changed = previousFingerprint !== null && previousFingerprint !== fingerprint;

    if (changed) {
      logger.warn(
        { productId, previousFingerprint, currentFingerprint: fingerprint },
        'Price container DOM structure change detected!',
      );
    }

    // Insert new snapshot
    const { error: insertErr } = await supabase.from('structure_snapshots').insert({
      product_id: productId,
      selector_fingerprint: fingerprint,
      changed,
      notes: changed ? `Structure changed from ${previousFingerprint}` : null,
    });

    if (insertErr) {
      logger.warn({ error: insertErr, productId }, 'Failed to save structure snapshot record');
    }

    return { changed, previousFingerprint };
  } catch (err) {
    logger.debug({ err, productId }, 'Skipping structure snapshot persistence (DB optional/offline)');
    return { changed: false, previousFingerprint: null };
  }
}
