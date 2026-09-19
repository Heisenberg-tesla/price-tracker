import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw, ExternalLink, ArrowRight, PackageX } from 'lucide-react';
import { listProducts } from '../api/products';
import { SearchBar } from '../components/SearchBar';
import { StatusBadge } from '../components/StatusBadge';
import { StructureChangeBadge } from '../components/StructureChangeBadge';
import { StockBadge } from '../components/StockBadge';
import { PriceChangeBadge } from '../components/PriceChangeBadge';
import { GlobalStatusStrip } from '../components/GlobalStatusStrip';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { ErrorBanner } from '../components/ErrorBanner';
import { formatMoney, formatRelativeTime, formatAbsoluteDateTime } from '../lib/formatters';
import { TrackedProduct } from '../types';

export const DashboardPage: React.FC = () => {
  // Fetch tracked products with dynamic auto-refresh:
  // Poll every 5s if any product is actively scraping; otherwise refresh every 60s
  const {
    data: products,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['products'],
    queryFn: listProducts,
    refetchInterval: (query) => {
      const data = query.state.data as TrackedProduct[] | undefined;
      const hasActiveScrape = data?.some((p) => p.isCurrentlyRunning);
      return hasActiveScrape ? 5000 : 60000;
    },
  });

  const trackedList = products || [];

  return (
    <div className="space-y-6">
      {/* 1. Header & Catalog Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Tracked Products Monitor</span>
            {isFetching && !isLoading && (
              <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
            )}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time price extraction, scheduled interval tracking, and DOM mutation auditing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50"
            title="Refresh tracked products data now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* 2. Live Store Catalog Search Bar */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Add Product to Monitor
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            Direct Store Search (Tier 1)
          </span>
        </div>
        <SearchBar trackedProducts={trackedList} />
      </div>

      {/* 3. Global Status Strip */}
      <GlobalStatusStrip products={trackedList} isRefreshing={isFetching} />

      {/* 4. Error State */}
      {isError && (
        <ErrorBanner
          title="Failed to load tracked products"
          error={error}
          onRetry={() => refetch()}
        />
      )}

      {/* 5. Loading State */}
      {isLoading && <LoadingSkeleton rows={5} />}

      {/* 6. Empty State */}
      {!isLoading && !isError && trackedList.length === 0 && (
        <div className="py-16 px-4 text-center bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl">
          <div className="inline-flex p-3 rounded-full bg-slate-800/80 text-slate-400 mb-3">
            <PackageX className="w-8 h-8 text-slate-500" />
          </div>
          <h3 className="text-base font-semibold text-slate-200">No products tracked yet</h3>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto mt-1 mb-4">
            Search for products in the catalogue bar above to begin automated price monitoring and
            historical price analytics.
          </p>
        </div>
      )}

      {/* 7. Tracked Products Table / Grid */}
      {!isLoading && !isError && trackedList.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Current Price</th>
                  <th className="py-3 px-4">24h Change</th>
                  <th className="py-3 px-4">Stock</th>
                  <th className="py-3 px-4">Scrape Status</th>
                  <th className="py-3 px-4">Last Scraped</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-normal">
                {trackedList.map((product) => (
                  <tr
                    key={product.id}
                    data-testid={`product-row-${product.id}`}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    {/* Product Name & Store Link */}
                    <td className="py-3.5 px-4 max-w-xs sm:max-w-sm">
                      <div className="flex items-center gap-3">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-10 h-10 rounded object-cover bg-slate-800 border border-slate-700 flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 font-mono text-[10px] flex-shrink-0">
                            PROD
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/products/${product.id}`}
                            className="font-semibold text-white hover:text-emerald-400 transition-colors block truncate text-sm"
                            title={product.name}
                          >
                            {product.name}
                          </Link>
                          <div className="flex items-center gap-2 mt-0.5 text-slate-400 text-[11px]">
                            {product.category && (
                              <span className="bg-slate-800/80 px-1.5 py-0.2 rounded border border-slate-700/60">
                                {product.category}
                              </span>
                            )}
                            {product.sku && (
                              <span className="font-mono text-slate-500">
                                SKU: {product.sku}
                              </span>
                            )}
                            <a
                              href={product.product_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-500 hover:text-slate-300 inline-flex items-center gap-0.5"
                              title="Open original store URL"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Current Price */}
                    <td className="py-3.5 px-4 font-mono text-sm font-semibold text-white">
                      {product.latestPriceCents !== null && product.latestPriceCents !== undefined ? (
                        formatMoney(product.latestPriceCents, 'INR')
                      ) : (
                        <span className="text-slate-500 text-xs font-normal italic">
                          Awaiting first scrape
                        </span>
                      )}
                    </td>

                    {/* 24h Change */}
                    <td className="py-3.5 px-4">
                      <PriceChangeBadge
                        change={product.priceChange24h}
                        currency="INR"
                      />
                    </td>

                    {/* Stock Status */}
                    <td className="py-3.5 px-4">
                      <StockBadge inStock={product.latestInStock} />
                    </td>

                    {/* Scrape Status & Structure Changed Badge */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
                        <StatusBadge
                          outcome={product.lastCompletedOutcome}
                          isRunning={product.isCurrentlyRunning}
                          errorType={product.lastErrorType}
                          retryCount={product.lastAttempts}
                        />
                        {product.structureChanged && <StructureChangeBadge />}
                      </div>
                    </td>

                    {/* Last Scraped Time */}
                    <td className="py-3.5 px-4">
                      <span
                        className="text-slate-300 cursor-help underline decoration-dotted decoration-slate-600"
                        title={formatAbsoluteDateTime(product.lastScrapedAt)}
                      >
                        {formatRelativeTime(product.lastScrapedAt)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/products/${product.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                      >
                        <span>View</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
