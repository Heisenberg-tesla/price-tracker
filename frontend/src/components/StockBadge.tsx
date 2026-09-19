import React from 'react';
import { Check, X, HelpCircle } from 'lucide-react';

interface StockBadgeProps {
  inStock: boolean | null | undefined;
  className?: string;
}

export const StockBadge: React.FC<StockBadgeProps> = ({ inStock, className = '' }) => {
  if (inStock === null || inStock === undefined) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 ${className}`}
        title="Stock status unknown until first scrape completes"
      >
        <HelpCircle className="w-3 h-3" />
        <span>Unknown</span>
      </span>
    );
  }

  if (inStock) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 ${className}`}
      >
        <Check className="w-3 h-3 text-emerald-400" />
        <span>In Stock</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 ${className}`}
    >
      <X className="w-3 h-3 text-rose-400" />
      <span>Out of Stock</span>
    </span>
  );
};
