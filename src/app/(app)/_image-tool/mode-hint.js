'use client';

import { useTransition } from 'react';
import { ArrowRight, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { moveSession } from './actions';

/**
 * Trusts the diagnostics: a black-and-white photo in Enhance (which cannot add color), or a
 * colour photo in Colorize (which would replace its colors), gets a one-click move.
 */
export function ModeHint({ session }) {
  const [pending, startTransition] = useTransition();
  const grayscale = session.source?.stats?.grayscale;
  if (grayscale === undefined || grayscale === null) return null;

  const wrong =
    session.mode === 'enhance' && grayscale
      ? { to: 'colorize', text: 'This photo looks black-and-white. Enhance only fixes tone; Colorize adds color.', action: 'Move to Colorize' }
      : session.mode === 'colorize' && !grayscale
        ? { to: 'enhance', text: 'This photo already has color. Colorize would replace it; Enhance corrects the colors it has.', action: 'Move to Enhance' }
        : null;
  if (!wrong) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand/10 p-4 text-sm sm:flex-row sm:items-center">
      <Info className="size-5 shrink-0 text-brand" />
      <p className="flex-1">{wrong.text}</p>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(() => moveSession(session.id, wrong.to))}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {wrong.action}
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
