import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ApiClientError } from '../api/client';

interface ErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  onRetry,
  title = 'An error occurred',
  className = '',
}) => {
  let errorMessage = 'An unexpected error occurred. Please try again.';
  let errorCode: string | undefined = undefined;
  let correlationId: string | undefined = undefined;

  if (error instanceof ApiClientError) {
    errorMessage = error.message;
    errorCode = error.code;
    correlationId = error.correlationId;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  }

  return (
    <div
      role="alert"
      className={`p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-rose-100">{title}</h3>
            <p className="text-xs text-rose-300/90 mt-1">{errorMessage}</p>

            {(errorCode || correlationId) && (
              <div className="flex flex-wrap items-center gap-3 mt-2 font-mono text-[11px] text-rose-400/80">
                {errorCode && <span>Code: {errorCode}</span>}
                {correlationId && <span>Trace: {correlationId}</span>}
              </div>
            )}
          </div>
        </div>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-900/50 hover:bg-rose-900 text-rose-200 text-xs font-medium border border-rose-700/50 transition-colors flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        )}
      </div>
    </div>
  );
};
