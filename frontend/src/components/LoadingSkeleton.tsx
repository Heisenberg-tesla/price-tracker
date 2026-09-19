import React from 'react';

interface LoadingSkeletonProps {
  rows?: number;
  className?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  rows = 5,
  className = '',
}) => {
  return (
    <div className={`space-y-3 animate-pulse ${className}`}>
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="h-16 bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-between px-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-slate-800" />
            <div className="space-y-1.5">
              <div className="w-48 h-4 rounded bg-slate-800" />
              <div className="w-24 h-3 rounded bg-slate-800/60" />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="w-20 h-4 rounded bg-slate-800" />
            <div className="w-24 h-6 rounded-full bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );
};
