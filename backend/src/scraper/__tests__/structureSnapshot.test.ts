import { describe, it, expect } from 'vitest';
import { computeStructureFingerprint, DomChildNodeSummary } from '../structureSnapshot';

describe('computeStructureFingerprint Suite', () => {
  it('produces the identical fingerprint regardless of price digit count (split spans variance)', () => {
    // Price carrier with 6 digit spans (e.g. ₹9,636)
    const nodesPriceA: DomChildNodeSummary[] = [
      { tagName: 'SPAN', ariaHidden: 'true', display: 'none' },
      { tagName: 'SPAN', ariaHidden: null, hasLineThrough: true },
      { tagName: 'OUTPUT', ariaHidden: null, hasChildSpans: true, childSpanCount: 6 },
      { tagName: 'SPAN', ariaHidden: null, isBadge: true },
      { tagName: 'SPAN', ariaHidden: 'true', display: 'none', datasetPrice: 'true' },
    ];

    // Same price carrier with 9 digit spans (e.g. ₹1,26,160)
    const nodesPriceB: DomChildNodeSummary[] = [
      { tagName: 'SPAN', ariaHidden: 'true', display: 'none' },
      { tagName: 'SPAN', ariaHidden: null, hasLineThrough: true },
      { tagName: 'OUTPUT', ariaHidden: null, hasChildSpans: true, childSpanCount: 9 },
      { tagName: 'SPAN', ariaHidden: null, isBadge: true },
      { tagName: 'SPAN', ariaHidden: 'true', display: 'none', datasetPrice: 'true' },
    ];

    const fpA = computeStructureFingerprint(nodesPriceA);
    const fpB = computeStructureFingerprint(nodesPriceB);

    expect(fpA).toBe(fpB);
  });

  it('produces a different fingerprint when true DOM structure mutates', () => {
    // Standard layout
    const standardNodes: DomChildNodeSummary[] = [
      { tagName: 'SPAN', ariaHidden: 'true', display: 'none' },
      { tagName: 'SPAN', ariaHidden: null, hasLineThrough: true },
      { tagName: 'DIV', ariaHidden: null, hasChildSpans: true, childSpanCount: 7 },
      { tagName: 'SPAN', ariaHidden: null, isBadge: true },
    ];

    // Mutated layout: carrier is a simple paragraph without split spans, honeypots missing
    const mutatedNodes: DomChildNodeSummary[] = [
      { tagName: 'P', ariaHidden: null, hasChildSpans: false },
    ];

    const fpStandard = computeStructureFingerprint(standardNodes);
    const fpMutated = computeStructureFingerprint(mutatedNodes);

    expect(fpStandard).not.toBe(fpMutated);
  });
});
