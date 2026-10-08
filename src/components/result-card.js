'use client';

import { CollapsibleHeader } from '@/components/collapsible-header';
import { cn } from '@/lib/utils';

/**
 * The frame every result sits in, in every tool: a heading that folds it away to one line — with
 * a thumbnail, so a folded result can still be recognised — and a brand border on the one the
 * composer is working on. `instruction` is the person's own words, shown above it like a message.
 */
export function ResultCard({ id, selected = false, open, onToggle, thumb, icon: Icon, number, label, facts, instruction, children }) {
  return (
    <div id={id} className="scroll-mt-20 space-y-2">
      {instruction && open ? <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2 text-sm">{instruction}</div> : null}
      <section className={cn('rounded-lg border bg-card/30 transition-colors', selected ? 'border-brand/70' : 'border-border', open ? 'space-y-3 p-3' : 'p-1.5')}>
        <CollapsibleHeader open={open} onToggle={onToggle}>
          {!open && thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="size-9 shrink-0 rounded object-cover" />
          ) : Icon ? (
            <Icon className="size-4 shrink-0 text-brand" />
          ) : null}
          <span className="shrink-0 font-medium">
            {number ? <span className="text-muted-foreground tabular-nums">#{number} </span> : null}
            {label}
          </span>
          {facts ? <span className="min-w-0 truncate text-muted-foreground">{facts}</span> : null}
          {!open && instruction ? <span className="hidden min-w-0 truncate text-xs text-muted-foreground italic sm:inline">“{instruction}”</span> : null}
        </CollapsibleHeader>
        {open ? children : null}
      </section>
    </div>
  );
}
