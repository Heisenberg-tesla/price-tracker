import React from 'react';

interface StatusBadgeProps {
  status: 'ok' | 'degraded' | 'error' | 'loading';
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const getStyles = () => {
    switch (status) {
      case 'ok':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'degraded':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'error':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'loading':
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const displayText = label || (status === 'ok' ? 'Online' : status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStyles()}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === 'ok'
            ? 'bg-emerald-400 animate-pulse'
            : status === 'error'
              ? 'bg-rose-400'
              : status === 'degraded'
                ? 'bg-amber-400'
                : 'bg-slate-400'
        }`}
      />
      {displayText}
    </span>
  );
};
