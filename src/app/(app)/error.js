'use client';

import { useEffect } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Something in a page failed: keep the sidebar, explain, and offer a retry. */
export default function AppError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto grid w-full max-w-md flex-1 place-items-center p-8 text-center">
      <div className="space-y-4">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border bg-card">
          <TriangleAlert className="size-5 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">This page could not be shown. Your photos and results are safe.</p>
          {error?.digest ? <p className="font-mono text-xs text-muted-foreground">Reference {error.digest}</p> : null}
        </div>
        <Button onClick={reset}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}
