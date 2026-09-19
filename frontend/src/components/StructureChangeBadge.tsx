import React from 'react';
import { EyeOff } from 'lucide-react';

interface StructureChangeBadgeProps {
  className?: string;
}

/**
 * Warning badge shown alongside status badge when price container DOM structure change is detected.
 */
export const StructureChangeBadge: React.FC<StructureChangeBadgeProps> = ({
  className = '',
}) => {
  return (
    <span
      data-testid="structure-changed-badge"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/40 ${className}`}
      title="Store price container DOM layout changed compared to previous baseline fingerprint"
    >
      <EyeOff className="w-3 h-3 text-purple-400" />
      <span>Structure Changed</span>
    </span>
  );
};
