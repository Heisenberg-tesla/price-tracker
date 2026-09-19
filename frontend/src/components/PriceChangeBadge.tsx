import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { PriceChange24h } from '../types';
import { formatMoney } from '../lib/formatters';

interface PriceChangeBadgeProps {
  change?: PriceChange24h | null;
  currency?: string;
  className?: string;
}

export const PriceChangeBadge: React.FC<PriceChangeBadgeProps> = ({
  change,
  currency = 'USD',
  className = '',
}) => {
  if (!change) {
    return <span className={`text-slate-500 font-mono text-xs ${className}`}>—</span>;
  }

  const { diffCents, percentage } = change;

  if (diffCents === 0) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 text-xs text-slate-400 font-mono ${className}`}
        title="Price unchanged in the last 24 hours"
      >
        <Minus className="w-3 h-3 text-slate-500" />
        <span>0.0%</span>
      </span>
    );
  }

  // Price dropped (favorable for buyer -> Emerald green)
  if (diffCents < 0) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-400 font-mono ${className}`}
        title={`Price dropped by ${formatMoney(Math.abs(diffCents), currency)} (${Math.abs(percentage)}%) in last 24h`}
      >
        <ArrowDownRight className="w-3.5 h-3.5 text-emerald-400" />
        <span>{percentage.toFixed(1)}%</span>
      </span>
    );
  }

  // Price increased (unfavorable for buyer -> Rose red)
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold text-rose-400 font-mono ${className}`}
      title={`Price increased by ${formatMoney(diffCents, currency)} (+${percentage}%) in last 24h`}
    >
      <ArrowUpRight className="w-3.5 h-3.5 text-rose-400" />
      <span>+{percentage.toFixed(1)}%</span>
    </span>
  );
};
