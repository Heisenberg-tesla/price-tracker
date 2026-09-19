import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Terminal,
  FileText,
} from 'lucide-react';
import { ScrapeLog } from '../types';
import { StatusBadge } from './StatusBadge';
import { formatMoney, formatDuration, formatRelativeTime, formatAbsoluteDateTime } from '../lib/formatters';

interface ScrapeLogsPanelProps {
  logs: ScrapeLog[];
  currency?: string;
}

export const ScrapeLogsPanel: React.FC<ScrapeLogsPanelProps> = ({ logs, currency = 'INR' }) => {
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  const toggleExpand = (logId: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Panel Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            Scrape Execution Logs
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            ({logs.length} runs recorded)
          </span>
        </div>
      </div>

      {/* Logs List */}
      {logs.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-400">
          No scrape execution logs recorded for this product yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-800/60" data-testid="scrape-logs-list">
          {logs.map((log) => {
            const isExpanded = expandedLogIds.has(log.id);
            const hasDetails = log.attempt_details && log.attempt_details.length > 0;

            return (
              <div
                key={log.id}
                data-testid={`scrape-log-${log.id}`}
                className={`transition-colors ${
                  log.outcome === 'failed'
                    ? 'bg-rose-950/10'
                    : log.outcome === 'abandoned'
                      ? 'bg-amber-950/10'
                      : 'hover:bg-slate-800/30'
                }`}
              >
                {/* Main Log Row */}
                <div
                  className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs cursor-pointer select-none"
                  onClick={() => hasDetails && toggleExpand(log.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {hasDetails ? (
                      <button
                        type="button"
                        aria-label={isExpanded ? 'Collapse attempt details' : 'Expand attempt details'}
                        className="text-slate-400 hover:text-slate-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(log.id);
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}

                    <StatusBadge
                      outcome={log.outcome}
                      errorType={log.error_type}
                      retryCount={log.attempts}
                    />

                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                      <span
                        className="text-slate-300 cursor-help underline decoration-dotted decoration-slate-600"
                        title={formatAbsoluteDateTime(log.started_at)}
                      >
                        {formatRelativeTime(log.started_at)}
                      </span>

                      <span className="text-slate-600">·</span>

                      <span className="text-slate-400 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {formatDuration(log.duration_ms)}
                      </span>

                      <span className="text-slate-600">·</span>

                      <span className="text-slate-400">
                        {log.attempts} {log.attempts === 1 ? 'attempt' : 'attempts'}
                      </span>

                      <span className="text-slate-600">·</span>

                      <span className="bg-slate-800 px-1.5 py-0.2 rounded text-slate-300 font-sans text-[10px] border border-slate-700/60 uppercase">
                        {log.trigger_source}
                      </span>
                    </div>
                  </div>

                  {/* Right side: Extracted price or error reason */}
                  <div className="flex items-center gap-3 self-end md:self-center font-mono">
                    {log.price_cents !== null && log.price_cents !== undefined ? (
                      <span className="text-sm font-semibold text-emerald-400">
                        {formatMoney(log.price_cents, currency)}
                      </span>
                    ) : log.error_type ? (
                      <span className="text-xs text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/50">
                        {log.error_type}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Error message strip if present */}
                {log.error_message && (
                  <div className="px-10 pb-2 text-[11px] text-rose-300/90 font-mono">
                    {log.error_message}
                  </div>
                )}

                {/* Expandable Attempt Details View */}
                {isExpanded && hasDetails && (
                  <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800/80 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      <span>Attempt Details Execution Telemetry</span>
                    </div>

                    <div className="space-y-1.5 font-mono text-[11px]">
                      {log.attempt_details.map((detail) => (
                        <div
                          key={detail.attempt}
                          className="p-2.5 rounded bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-300 font-bold">
                              Attempt #{detail.attempt}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-400">{detail.strategy}</span>
                            {detail.status && (
                              <>
                                <span className="text-slate-500">·</span>
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] ${
                                    detail.status >= 200 && detail.status < 300
                                      ? 'bg-emerald-950 text-emerald-400'
                                      : 'bg-rose-950 text-rose-400'
                                  }`}
                                >
                                  HTTP {detail.status}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-slate-400">
                              {formatDuration(detail.durationMs)}
                            </span>
                            {detail.error ? (
                              <span className="text-rose-400 truncate max-w-xs" title={detail.error}>
                                {detail.error}
                              </span>
                            ) : (
                              <span className="text-emerald-400">Success</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
