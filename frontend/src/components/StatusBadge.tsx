import React from 'react';
import {
  CheckCircle2,
  AlertOctagon,
  AlertTriangle,
  RotateCw,
  Loader2,
} from 'lucide-react';
import { ScrapeOutcome } from '../types';

export interface StatusBadgeProps {
  outcome?: ScrapeOutcome | null;
  isRunning?: boolean;
  errorType?: string | null;
  retryCount?: number | null;
  className?: string;
  showRunningOverlay?: boolean;
}

/**
 * Five-State Scrape Status Badge
 *
 * Distinct styling, iconography, and accessible semantics for all 5 lifecycle states:
 * 1. 'pending' (or isRunning) -> Cyan/Blue with spinning Loader2: "Scraping now…"
 * 2. 'success' -> Emerald Green with CheckCircle2: "Up to date"
 * 3. 'success_after_retry' -> Teal/Amber with RotateCw: "Up to date (after retry)" + retry count
 * 4. 'failed' -> Rose/Red with AlertOctagon: "Failed" + error_type on hover
 * 5. 'abandoned' -> Distinct Amber/Orange with AlertTriangle: "Interrupted" + crash explanation
 *
 * Never hides the last known-good result when a new run starts (isRunning=true layers on top).
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  outcome,
  isRunning = false,
  errorType,
  retryCount,
  className = '',
  showRunningOverlay = true,
}) => {
  // If no previous completed outcome and running: show standalone pending spinner
  if (!outcome && isRunning) {
    return (
      <span
        data-testid="status-badge-pending"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 ${className}`}
        title="Scrape operation actively in progress"
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
        <span>Scraping now…</span>
      </span>
    );
  }

  // Determine badge styling for completed outcome
  let badgeContent: React.ReactNode = null;
  let tooltip = '';

  switch (outcome) {
    case 'success':
      tooltip = 'Scrape succeeded on first attempt. Data is current.';
      badgeContent = (
        <span
          data-testid="status-badge-success"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
          title={tooltip}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Up to date</span>
        </span>
      );
      break;

    case 'success_after_retry':
      tooltip = `Scrape succeeded after retry recovery (${retryCount ? `${retryCount} attempts` : 'recovered'}).`;
      badgeContent = (
        <span
          data-testid="status-badge-success_after_retry"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30"
          title={tooltip}
        >
          <RotateCw className="w-3.5 h-3.5 text-teal-300" />
          <span>Up to date (after retry)</span>
          {retryCount && retryCount > 1 && (
            <span className="text-[10px] px-1 py-0.2 bg-teal-900/60 rounded text-teal-200">
              {retryCount}x
            </span>
          )}
        </span>
      );
      break;

    case 'failed':
      tooltip = `Scrape failed: ${errorType ? `Error type "${errorType}"` : 'All retry attempts exhausted'}`;
      badgeContent = (
        <span
          data-testid="status-badge-failed"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30"
          title={tooltip}
        >
          <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
          <span>Failed</span>
          {errorType && (
            <span className="text-[10px] px-1 py-0.2 bg-rose-950/80 rounded font-mono text-rose-300">
              {errorType}
            </span>
          )}
        </span>
      );
      break;

    case 'abandoned':
      tooltip =
        'Run was abandoned: process terminated or instance suspended before completion reported back.';
      badgeContent = (
        <span
          data-testid="status-badge-abandoned"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/40"
          title={tooltip}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span>Interrupted</span>
        </span>
      );
      break;

    case 'pending':
      tooltip = 'Scrape actively running';
      badgeContent = (
        <span
          data-testid="status-badge-pending"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30"
          title={tooltip}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
          <span>Scraping now…</span>
        </span>
      );
      break;

    default:
      badgeContent = (
        <span
          data-testid="status-badge-none"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700"
          title="No scrape recorded yet"
        >
          <span>Never scraped</span>
        </span>
      );
      break;
  }

  // If currently running, layer the live spinner alongside without hiding previous outcome
  if (isRunning && showRunningOverlay && outcome !== 'pending') {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        {badgeContent}
        <span
          data-testid="status-badge-running-overlay"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse"
          title="New scrape cycle actively in flight"
        >
          <Loader2 className="w-3 h-3 animate-spin text-sky-300" />
          <span>Scraping…</span>
        </span>
      </div>
    );
  }

  return <div className={`inline-block ${className}`}>{badgeContent}</div>;
};
