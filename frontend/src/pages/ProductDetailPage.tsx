import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { getProduct, getProductHistory, getProductLogs } from '../api/products';
import { StatusBadge } from '../components/StatusBadge';
import { StructureChangeBadge } from '../components/StructureChangeBadge';
import { StockBadge } from '../components/StockBadge';
import { PriceChangeBadge } from '../components/PriceChangeBadge';
import { PriceHistoryChart } from '../components/PriceHistoryChart';
import { ScrapeLogsPanel } from '../components/ScrapeLogsPanel';
import { ProductControls } from '../components/ProductControls';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { formatMoney } from '../lib/formatters';
import { TrackedProduct } from '../types';

export const ProductDetailPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('30d');

  // 1. Fetch Product Details with dynamic polling if scrape is running
  const {
    data: product,
    isLoading: isProductLoading,
    isError: isProductError,
    error: productError,
    refetch: refetchProduct,
    isFetching: isProductFetching,
  } = useQuery({
    queryKey: ['product', id],
    queryFn: () => getProduct(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const p = query.state.data as TrackedProduct | undefined;
      return p?.isCurrentlyRunning ? 3000 : 30000;
    },
  });

  // 2. Fetch Price History
  const {
    data: history = [],
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['productHistory', id, range],
    queryFn: () => getProductHistory(id, range),
    enabled: !!id,
    refetchInterval: product?.isCurrentlyRunning ? 3000 : 30000,
  });

  // 3. Fetch Scrape Execution Logs
  const {
    data: logs = [],
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ['productLogs', id],
    queryFn: () => getProductLogs(id, 50),
    enabled: !!id,
    refetchInterval: product?.isCurrentlyRunning ? 3000 : 30000,
  });

  const handleManualSync = () => {
    refetchProduct();
    refetchHistory();
    refetchLogs();
  };

  if (isProductLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-32 bg-slate-800 rounded animate-pulse" />
        <LoadingSkeleton rows={4} />
      </div>
    );
  }

  if (isProductError || !product) {
    return (
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>
        <ErrorBanner
          title="Product not found"
          error={productError || new Error('Product not found')}
          onRetry={handleManualSync}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Navigation Breadcrumb & Quick Actions */}
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>

        <button
          type="button"
          onClick={handleManualSync}
          disabled={isProductFetching}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-800 transition-colors disabled:opacity-50"
          title="Sync product, history, and logs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isProductFetching ? 'animate-spin' : ''}`} />
          <span>Sync</span>
        </button>
      </div>

      {/* 2. Header Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-16 h-16 rounded-lg object-cover bg-slate-800 border border-slate-700 flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 font-mono text-sm flex-shrink-0">
                PROD
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <StatusBadge
                  outcome={product.lastCompletedOutcome}
                  isRunning={product.isCurrentlyRunning}
                  errorType={product.lastErrorType}
                  retryCount={product.lastAttempts}
                />
                {product.structureChanged && <StructureChangeBadge />}
                <StockBadge inStock={product.latestInStock} />
              </div>

              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug">
                {product.name}
              </h1>

              <div className="flex flex-wrap items-center gap-2.5 mt-2 text-xs text-slate-400">
                {product.category && (
                  <span className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700 font-medium">
                    {product.category}
                  </span>
                )}
                {product.sku && (
                  <span className="font-mono text-slate-400">SKU: {product.sku}</span>
                )}
                <a
                  href={product.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 hover:underline"
                >
                  <span>Store Page</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Quick Price KPI Block */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 min-w-[200px] flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Current Price
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-white">
                {formatMoney(product.latestPriceCents, 'INR')}
              </span>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-500">24h Change:</span>
              <PriceChangeBadge change={product.priceChange24h} currency="INR" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Product Action Controls Strip */}
      <ProductControls product={product} onScrapeStarted={handleManualSync} />

      {/* 4. Price History Chart & Table */}
      <PriceHistoryChart
        history={history}
        range={range}
        onRangeChange={setRange}
        currency="INR"
      />

      {/* 5. Scrape Execution Logs Panel */}
      <ScrapeLogsPanel logs={logs} currency="INR" />
    </div>
  );
};
