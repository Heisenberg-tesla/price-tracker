import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileStalePendingLogs } from '../../db/repository';
import { getSupabaseClient } from '../../db/client';
import { scrapeProduct } from '../scrapeProduct';
import * as browserFetcher from '../browserFetcher';

vi.mock('../../db/client');
vi.mock('../browserFetcher');
vi.mock('../structureSnapshot', () => ({
  recordStructureSnapshot: vi.fn().mockResolvedValue({ changed: false, previousFingerprint: null }),
  computeStructureFingerprint: vi.fn().mockReturnValue('MOCK_FINGERPRINT'),
}));

describe('Pending Crash and Stale Log Reconciliation Test', () => {
  const mockProduct = {
    id: 'prod-uuid-999',
    product_url: 'https://demo.inelabteamdev.com/product/915',
    name: 'Ironwood Trackpad Studio',
  };

  // Mock in-memory database table for scrape_logs
  interface DbScrapeLog {
    id: string;
    product_id: string;
    started_at: string;
    finished_at: string | null;
    outcome: string;
    error_type: string | null;
    error_message: string | null;
  }

  let dbLogs: DbScrapeLog[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    dbLogs = [];

    // Setup mock supabase query builder
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'scrape_logs') {
          return {
            insert: (payload: Partial<DbScrapeLog>) => ({
              select: () => ({
                single: async () => {
                  const record: DbScrapeLog = {
                    id: payload.id || `log-${Date.now()}-${Math.random()}`,
                    product_id: payload.product_id!,
                    started_at: payload.started_at || new Date().toISOString(),
                    finished_at: null,
                    outcome: 'pending',
                    error_type: null,
                    error_message: null,
                  };
                  dbLogs.push(record);
                  return { data: record, error: null };
                },
              }),
            }),
            update: (updatePayload: Partial<DbScrapeLog>) => ({
              eq: (field: string, val: string) => ({
                select: () => ({
                  single: async () => {
                    const found = dbLogs.find((l) => (l as unknown as Record<string, unknown>)[field] === val);
                    if (found) {
                      Object.assign(found, updatePayload);
                    }
                    return { data: found, error: null };
                  },
                }),
              }),
              in: async (field: string, values: string[]) => {
                let updatedCount = 0;
                for (const log of dbLogs) {
                  if (values.includes((log as unknown as Record<string, unknown>)[field] as string)) {
                    Object.assign(log, updatePayload);
                    updatedCount++;
                  }
                }
                return { data: null, error: null, count: updatedCount };
              },
            }),
            select: (_cols: string) => {
              const queryObj = {
                eq: (field: string, val: string) => ({
                  ...queryObj,
                  maybeSingle: async () => {
                    const found = dbLogs.find((l) => (l as unknown as Record<string, unknown>)[field] === val);
                    return { data: found || null, error: null };
                  },
                  single: async () => {
                    const found = dbLogs.find((l) => (l as unknown as Record<string, unknown>)[field] === val);
                    return { data: found || null, error: null };
                  },
                  lte: async (_timeField: string, cutoff: string) => {
                    const filtered = dbLogs.filter(
                      (l) =>
                        (l as unknown as Record<string, unknown>)[field] === val &&
                        new Date(l.started_at).getTime() <= new Date(cutoff).getTime(),
                    );
                    return { data: filtered, error: null };
                  },
                }),
                lte: async (_field: string, cutoff: string) => {
                  const filtered = dbLogs.filter(
                    (l) => new Date(l.started_at).getTime() <= new Date(cutoff).getTime(),
                  );
                  return { data: filtered, error: null };
                },
              };
              return queryObj;
            },
          };
        }
        return {};
      }),
    };

    vi.mocked(getSupabaseClient).mockReturnValue(mockSupabase as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it('orchestrator NEVER outputs "abandoned" outcome under any circumstances', async () => {
    vi.mocked(browserFetcher.fetchPriceWithBrowser).mockRejectedValue(new Error('Fatal network partition'));

    const result = await scrapeProduct(mockProduct, { maxAttempts: 1 });

    // Orchestrator terminal outcome must be 'failed', never 'abandoned'
    expect(result.outcome).toBe('failed');
    expect(result.outcome).not.toBe('abandoned');

    const logInDb = dbLogs.find((l) => l.id === result.log.id);
    expect(logInDb?.outcome).toBe('failed');
  });

  it('proves a simulated process crash leaves a "pending" row that ONLY reconcileStalePendingLogs resolves to "abandoned"', async () => {
    // 1. Simulate a worker that starts a scrape (creating pending log) but crashes before finalising
    const crashedLogTime = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 mins ago
    dbLogs.push({
      id: 'crashed-log-1',
      product_id: mockProduct.id,
      started_at: crashedLogTime,
      finished_at: null,
      outcome: 'pending', // Unclosed pending row left by crashed process
      error_type: null,
      error_message: null,
    });

    // Also add an active in-flight scrape that started 30 seconds ago (should NOT be marked abandoned)
    const activeLogTime = new Date(Date.now() - 30 * 1000).toISOString();
    dbLogs.push({
      id: 'active-log-2',
      product_id: mockProduct.id,
      started_at: activeLogTime,
      finished_at: null,
      outcome: 'pending',
      error_type: null,
      error_message: null,
    });

    // Before reconciliation: both are pending
    expect(dbLogs[0]?.outcome).toBe('pending');
    expect(dbLogs[1]?.outcome).toBe('pending');

    // 2. Run reconciliation with a 10-minute threshold (600,000 ms)
    const result = await reconcileStalePendingLogs(600_000);

    // Assert only the crashed log (>10m) was reconciled
    expect(result.reconciledCount).toBe(1);
    expect(result.reconciledIds).toEqual(['crashed-log-1']);

    // Assert crashed log is now abandoned with explanatory error
    const reconciledLog = dbLogs.find((l) => l.id === 'crashed-log-1');
    expect(reconciledLog?.outcome).toBe('abandoned');
    expect(reconciledLog?.finished_at).not.toBeNull();
    expect(reconciledLog?.error_type).toBe('abandoned');
    expect(reconciledLog?.error_message).toContain('Process likely terminated or crashed');

    // Assert recently started log is untouched and still pending
    const activeLog = dbLogs.find((l) => l.id === 'active-log-2');
    expect(activeLog?.outcome).toBe('pending');
  });
});
