'use client';

import { useTransition } from 'react';
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { setDone } from '@/app/(app)/history-actions';
import { Button } from '@/components/ui/button';

/**
 * Marks the photo or video being looked at as done — it moves to the Done group of the history —
 * or, once done, back in progress. `doneOn` is the date it was marked, ready to show.
 */
export function DoneButton({ kind, sessionId, doneOn = null }) {
  const [pending, startTransition] = useTransition();
  const done = Boolean(doneOn);
  const toggle = () =>
    startTransition(async () => {
      const result = await setDone({ kind, sessionId, done: !done });
      if (result?.error) toast.error(result.error);
    });
  const Icon = pending ? Loader2 : done ? RotateCcw : CheckCircle2;
  return (
    <div className="flex items-center gap-1">
      {done ? <span className="hidden text-xs text-muted-foreground sm:inline">Done · {doneOn}</span> : null}
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={toggle} disabled={pending} aria-label={done ? 'Back in progress' : 'Mark as done'}>
        <Icon className={pending ? 'size-4 animate-spin' : 'size-4'} />
        <span className="hidden sm:inline">{done ? 'Back in progress' : 'Mark as done'}</span>
      </Button>
    </div>
  );
}
