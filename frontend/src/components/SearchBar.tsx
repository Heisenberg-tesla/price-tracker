import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, Plus, Check, X, AlertCircle, ExternalLink } from 'lucide-react';
import { searchStoreCatalog, createProduct } from '../api/products';
import { StoreProductSearchResult, TrackedProduct } from '../types';
import { ApiClientError } from '../api/client';

interface SearchBarProps {
  trackedProducts?: TrackedProduct[];
  onProductTracked?: (product: TrackedProduct) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  trackedProducts = [],
  onProductTracked,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // 400ms debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchTerm.trim());
    }, 400);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Query catalog
  const {
    data: searchResults,
    isLoading: isSearching,
    isError,
    error: searchError,
  } = useQuery({
    queryKey: ['catalogSearch', debouncedQuery],
    queryFn: () => searchStoreCatalog(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 min client cache
  });

  // Track product mutation
  const trackMutation = useMutation({
    mutationFn: (item: StoreProductSearchResult) =>
      createProduct({
        productUrl: item.url,
        name: item.name,
      }),
    onSuccess: (newlyTracked) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setErrorMessage(null);
      if (onProductTracked) {
        onProductTracked(newlyTracked);
      }
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to track product. Please try again.');
      }
    },
  });

  const trackedUrlSet = new Set(trackedProducts.map((p) => p.product_url.toLowerCase()));

  const handleClear = () => {
    setSearchTerm('');
    setDebouncedQuery('');
    setIsOpen(false);
    setErrorMessage(null);
  };

  return (
    <div className="relative w-full max-w-3xl">
      {/* Search Input Bar */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </div>

        <input
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setIsOpen(true);
            setErrorMessage(null);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search store catalogue by product name, brand, SKU or category..."
          className="w-full pl-10 pr-10 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-inner"
          aria-label="Search store catalogue"
        />

        {searchTerm && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown Panel */}
      {isOpen && debouncedQuery.length >= 2 && (
        <div className="absolute z-50 mt-2 w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden backdrop-blur-lg">
          {/* Header Strip */}
          <div className="px-4 py-2 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Store Catalogue Search Results</span>
            <span className="text-[11px] text-slate-500 font-mono">Tier 1 API (Catalog cache)</span>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-rose-500/15 border-b border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Search Error */}
          {isError && (
            <div className="p-4 text-center text-xs text-rose-400">
              Failed to query store catalogue: {searchError instanceof Error ? searchError.message : 'Unknown error'}
            </div>
          )}

          {/* Loading State */}
          {isSearching && !searchResults && (
            <div className="p-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Searching catalogue…</span>
            </div>
          )}

          {/* Empty Results */}
          {!isSearching && searchResults && searchResults.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">
              No products found matching &ldquo;<span className="text-slate-200">{debouncedQuery}</span>&rdquo;.
            </div>
          )}

          {/* Results List */}
          {searchResults && searchResults.length > 0 && (
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/60" data-testid="search-results-list">
              {searchResults.map((item) => {
                const isAlreadyTracked = trackedUrlSet.has(item.url.toLowerCase());
                const isPendingTrack =
                  trackMutation.isPending && trackMutation.variables?.url === item.url;

                return (
                  <div
                    key={item.storeProductId || item.url}
                    data-testid={`search-result-${item.storeProductId}`}
                    className="p-3.5 hover:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                  >
                    {/* Product Metadata */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-10 h-10 rounded object-cover bg-slate-800 border border-slate-700 flex-shrink-0"
                          onError={(e) => {
                            // Fallback if image 404s
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 font-mono text-xs flex-shrink-0">
                          ID
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-white truncate" title={item.name}>
                            {item.name}
                          </h4>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-500 hover:text-slate-300 flex-shrink-0"
                            title="View product on demo store"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {item.brand && (
                            <span className="text-[11px] font-medium text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                              {item.brand}
                            </span>
                          )}
                          {item.category && (
                            <span className="text-[11px] font-medium text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                              {item.category}
                            </span>
                          )}
                          {item.sku && (
                            <span className="text-[11px] font-mono text-slate-500">
                              SKU: {item.sku}
                            </span>
                          )}
                        </div>

                        {/* Note on Tier 1 Search Contract: Strictly No Price */}
                        <div className="mt-1 text-[11px] text-slate-500 italic">
                          Price determined via Tier 2 browser scrape upon tracking
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="flex-shrink-0 self-end sm:self-center">
                      {isAlreadyTracked ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 cursor-default">
                          <Check className="w-3.5 h-3.5" />
                          <span>Tracked</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => trackMutation.mutate(item)}
                          disabled={isPendingTrack}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50"
                        >
                          {isPendingTrack ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Tracking…</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span>Track this product</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer note */}
          <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
            <span>Press Escape to close</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200 underline"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
