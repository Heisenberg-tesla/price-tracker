import React from 'react';
import { Package, AlertOctagon, AlertTriangle, PlayCircle, Loader2 } from 'lucide-react';
import { TrackedProduct } from '../types';

interface GlobalStatusStripProps {
  products: TrackedProduct[];
  isRefreshing?: boolean;
}

export const GlobalStatusStrip: React.FC<GlobalStatusStripProps> = ({
  products,
  isRefreshing = false,
}) => {
  const total = products.length;
  const activeCount = products.filter((p) => p.is_active).length;
  const runningCount = products.filter((p) => p.isCurrentlyRunning).length;

  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Count failures in last 24h
  const failures24h = products.filter((p) => {
    if (p.lastCompletedOutcome !== 'failed') return false;
    if (!p.lastScrapedAt) return false;
    return new Date(p.lastScrapedAt).getTime() >= twentyFourHoursAgo;
  }).length;

  // Count abandoned runs in last 24h (strictly separate from failures)
  const abandoned24h = products.filter((p) => {
    if (p.lastCompletedOutcome !== 'abandoned') return false;
    if (!p.lastScrapedAt) return false;
    return new Date(p.lastScrapedAt).getTime() >= twentyFourHoursAgo;
  }).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/90 border border-slate-800 rounded-xl p-3 sm:p-4 text-xs">
      {/* 1. Tracked Products */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60">
          <Package className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <span className="text-slate-400 font-medium block">Total Tracked</span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-lg font-bold text-white font-mono">{total}</span>
            <span className="text-[11px] text-slate-500 font-mono">({activeCount} active)</span>
          </div>
        </div>
      </div>

      {/* 2. Currently Running */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60">
          {runningCount > 0 || isRefreshing ? (
            <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
          ) : (
            <PlayCircle className="w-4 h-4 text-sky-400" />
          )}
        </div>
        <div>
          <span className="text-slate-400 font-medium block">Active Scrapes</span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-lg font-bold text-sky-400 font-mono">{runningCount}</span>
            <span className="text-[11px] text-slate-500 font-mono">
              {runningCount > 0 ? 'running now' : 'idle'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Failures in 24h */}
      <div className="flex items-center gap-3">
        <div
          className={`p-2 rounded-lg border ${
            failures24h > 0
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              : 'bg-slate-800 border-slate-700/60 text-slate-500'
          }`}
        >
          <AlertOctagon className="w-4 h-4" />
        </div>
        <div>
          <span className="text-slate-400 font-medium block">Failures (24h)</span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span
              className={`text-lg font-bold font-mono ${
                failures24h > 0 ? 'text-rose-400' : 'text-slate-300'
              }`}
            >
              {failures24h}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">exhausted retries</span>
          </div>
        </div>
      </div>

      {/* 4. Abandoned / Interrupted in 24h (Separated from failures) */}
      <div className="flex items-center gap-3">
        <div
          className={`p-2 rounded-lg border ${
            abandoned24h > 0
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-slate-800 border-slate-700/60 text-slate-500'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div>
          <span className="text-slate-400 font-medium block">Interrupted (24h)</span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span
              className={`text-lg font-bold font-mono ${
                abandoned24h > 0 ? 'text-amber-400' : 'text-slate-300'
              }`}
            >
              {abandoned24h}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">stale / killed</span>
          </div>
        </div>
      </div>
    </div>
  );
};
