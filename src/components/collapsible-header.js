'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A result's one-line heading that folds it away and back when clicked, so a long thread stays
 * readable. The chevron only shows which way it will go. Without `onToggle` it is plain text,
 * e.g. while a run is in progress and its status is the point.
 */
export function CollapsibleHeader({ open, onToggle, what = 'result', className, children }) {
  if (!onToggle) return <div className={cn('flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm', className)}>{children}</div>;
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={open ? `Hide this ${what}` : `Show this ${what}`}
      className={cn(
        'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      {children}
      <Icon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}
