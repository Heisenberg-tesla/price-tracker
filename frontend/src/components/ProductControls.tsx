import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Loader2,
  Clock,
  Pause,
  Trash2,
  AlertTriangle,
  Check,
  AlertCircle,
} from 'lucide-react';
import { triggerProductScrape, updateProduct, deleteProduct } from '../api/products';
import { TrackedProduct } from '../types';
import { ApiClientError } from '../api/client';

interface ProductControlsProps {
  product: TrackedProduct;
  onScrapeStarted?: () => void;
}

export const ProductControls: React.FC<ProductControlsProps> = ({
  product,
  onScrapeStarted,
}) => {
  const [scrapeFeedback, setScrapeFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const [intervalMinutes, setIntervalMinutes] = useState(
    product.scrape_interval_minutes || 120,
  );
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // 1. Scrape Now Mutation
  const scrapeMutation = useMutation({
    mutationFn: () => triggerProductScrape(product.id),
    onSuccess: () => {
      setScrapeFeedback({
        type: 'success',
        message: 'Scrape started in background. Polling for results…',
      });
      // Invalidate queries so polling picks up isCurrentlyRunning=true immediately
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['productLogs', product.id] });
      if (onScrapeStarted) onScrapeStarted();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError && err.statusCode === 409) {
        // Clean, human-friendly 409 surface
        setScrapeFeedback({
          type: 'warning',
          message: 'A scrape is already in progress for this product.',
        });
      } else if (err instanceof ApiClientError) {
        setScrapeFeedback({
          type: 'error',
          message: err.message,
        });
      } else {
        setScrapeFeedback({
          type: 'error',
          message: 'Failed to trigger scrape. Please try again.',
        });
      }
    },
  });

  // 2. Interval Update Mutation
  const intervalMutation = useMutation({
    mutationFn: (newInterval: number) =>
      updateProduct(product.id, { scrapeIntervalMinutes: newInterval }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError) {
        setIntervalError(err.message);
      } else {
        setIntervalError('Failed to update scrape interval.');
      }
    },
  });

  // 3. Pause / Resume Toggle Mutation
  const toggleActiveMutation = useMutation({
    mutationFn: () => updateProduct(product.id, { isActive: !product.is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  // 4. Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      navigate('/');
    },
  });

  const handleIntervalChange = (val: number) => {
    setIntervalMinutes(val);
    if (val < 5 || val > 1440) {
      setIntervalError('Interval must be between 5 and 1440 minutes (24h)');
    } else {
      setIntervalError(null);
    }
  };

  const handleSaveInterval = () => {
    if (intervalMinutes < 5 || intervalMinutes > 1440) {
      setIntervalError('Interval must be between 5 and 1440 minutes');
      return;
    }
    intervalMutation.mutate(intervalMinutes);
  };

  const hasIntervalChanged =
    intervalMinutes !== product.scrape_interval_minutes &&
    intervalMinutes >= 5 &&
    intervalMinutes <= 1440;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left side: Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Scrape Now Button */}
          <button
            type="button"
            onClick={() => {
              setScrapeFeedback(null);
              scrapeMutation.mutate();
            }}
            disabled={product.isCurrentlyRunning || scrapeMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            title="Execute immediate price extraction scrape"
          >
            {product.isCurrentlyRunning || scrapeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Scraping in progress…</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Scrape Now</span>
              </>
            )}
          </button>

          {/* Pause / Resume Toggle */}
          <button
            type="button"
            onClick={() => toggleActiveMutation.mutate()}
            disabled={toggleActiveMutation.isPending}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
              product.is_active
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
            }`}
            title={product.is_active ? 'Pause automated scheduled scraping' : 'Resume automated scraping'}
          >
            {product.is_active ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause Monitor</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume Monitor</span>
              </>
            )}
          </button>
        </div>

        {/* Right side: Delete button */}
        <div>
          <button
            type="button"
            onClick={() => setIsDeleteModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Product</span>
          </button>
        </div>
      </div>

      {/* Scrape Feedback Banner (with aria-live for accessibility) */}
      <div aria-live="polite" className="text-xs">
        {scrapeFeedback && (
          <div
            className={`p-3 rounded-lg border flex items-center gap-2 ${
              scrapeFeedback.type === 'success'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : scrapeFeedback.type === 'warning'
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
            }`}
          >
            {scrapeFeedback.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : scrapeFeedback.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{scrapeFeedback.message}</span>
          </div>
        )}
      </div>

      {/* Scrape Interval Configuration Strip */}
      <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          <Clock className="w-4 h-4 text-slate-500" />
          <span>Scrape Interval (5 – 1440 min):</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Preset Buttons */}
          <div className="hidden md:inline-flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 text-[11px]">
            {[30, 60, 120, 360, 1440].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => handleIntervalChange(mins)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  intervalMinutes === mins
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mins < 60 ? `${mins}m` : `${mins / 60}h`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={5}
              max={1440}
              value={intervalMinutes}
              onChange={(e) => handleIntervalChange(parseInt(e.target.value, 10) || 5)}
              className="w-20 px-2.5 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 font-mono text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
            <span className="text-slate-500">min</span>
          </div>

          {hasIntervalChanged && (
            <button
              type="button"
              onClick={handleSaveInterval}
              disabled={intervalMutation.isPending}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
            >
              {intervalMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {intervalError && (
        <div className="text-[11px] text-rose-400 font-mono">{intervalError}</div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-white">Delete Tracked Product</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to stop tracking{' '}
              <strong className="text-white font-semibold">&ldquo;{product.name}&rdquo;</strong>?
              All historical price points and scrape logs will be permanently deleted.
            </p>

            <div className="pt-2 flex items-center justify-end gap-3 text-xs">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <span>Yes, Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
