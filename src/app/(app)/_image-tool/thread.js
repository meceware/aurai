'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Histogram } from '@/components/histogram';
import { ResultCard } from '@/components/result-card';
import { Composer } from './composer';
import { ModeHint } from './mode-hint';
import { DEFAULT_VIEW, RunCard, viewForServer } from './run-card';

const media = (id) => `/api/media/${id}`;
const isActive = (run) => run.status === 'queued' || run.status === 'running';

/**
 * While any run is queued or running, asks the server for statuses every few seconds and
 * re-renders the page from the server once one changes.
 */
function useRunPolling(sessionId, runs) {
  const router = useRouter();
  const active = runs.some(isActive);
  const signature = runs.map((run) => `${run.id}:${run.status}`).join(',');

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/activity?session=${sessionId}`, { cache: 'no-store' });
        if (!response.ok) return;
        const { runs: latest } = await response.json();
        if (latest.map((run) => `${run.id}:${run.status}`).join(',') !== signature) router.refresh();
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [active, signature, sessionId, router]);

  // Announce finished runs, including to someone who switched tabs while waiting.
  const previous = useRef(new Map(runs.map((run) => [run.id, run.status])));
  useEffect(() => {
    for (const run of runs) {
      const before = previous.current.get(run.id);
      if (before && before !== run.status && (before === 'queued' || before === 'running')) {
        if (run.status === 'succeeded') toast.success(`Result #${runs.findIndex((r) => r.id === run.id) + 1} is ready`);
        if (run.status === 'failed') toast.error('A run failed', { description: run.error });
      }
    }
    previous.current = new Map(runs.map((run) => [run.id, run.status]));
  }, [runs]);
}

function OriginalCard({ source }) {
  const [open, setOpen] = useState(true);
  return (
    <ResultCard
      open={open}
      onToggle={() => setOpen(!open)}
      thumb={media(source.displayId)}
      icon={ImageIcon}
      label="Original"
      facts={`${source.filename ? `${source.filename} · ` : ''}${source.width}×${source.height}`}
    >
      <div className="overflow-hidden rounded-md bg-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media(source.displayId)}
          alt="Original photo"
          className="mx-auto max-h-[60vh] w-auto object-contain"
          style={{ aspectRatio: `${source.width} / ${source.height}` }}
        />
      </div>
      {source.summary ? (
        <details className="group border-t px-1.5 pt-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-muted-foreground marker:text-muted-foreground group-open:text-foreground">
            Diagnostics
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_16rem] sm:items-center">
            <ul className="space-y-1 text-muted-foreground">
              {source.summary.split('\n').map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Histogram histogram={source.histogram} className="h-20 w-full rounded-md bg-stage/60" />
          </div>
        </details>
      ) : null}
    </ResultCard>
  );
}

export function Thread({ session, tool, canRun, prefs, options, labels, analysisCost }) {
  useRunPolling(session.id, session.runs);
  const end = useRef(null);
  const count = session.runs.length;
  const first = useRef(true);
  // How the next run continues (refine / start over / repeat) and from which result. Choosing
  // "Refine" on a card sets both and puts the cursor in the composer.
  const [selection, setSelection] = useState({ action: tool.refine ? 'refine' : 'new', runId: null });
  // What each card shows (Local or AI, and the Local dials). Refining starts from exactly that.
  const [views, setViews] = useState({});
  const viewOf = (runId) => views[runId] ?? DEFAULT_VIEW;
  const setView = (runId) => (update) => setViews((current) => ({ ...current, [runId]: update(current[runId] ?? DEFAULT_VIEW) }));
  const [focusSignal, setFocusSignal] = useState(0);
  const [composerOpen, setComposerOpen] = useState(true);

  const labelOf = (run) => `${labels[run.model] ?? run.model}${run.quality && run.quality !== 'auto' ? ` · ${run.quality}` : ''}`;
  const runs = session.runs.map((run, index) => ({ ...run, number: index + 1 }));
  const byId = new Map(runs.map((run) => [run.id, run]));
  const finished = runs
    .filter((run) => run.status === 'succeeded' && run.locked)
    .map((run) => ({
      id: run.id,
      number: run.number,
      model: run.model,
      instruction: run.instruction,
      label: labelOf(run),
      // Both renditions, so comparing follows whichever version is on screen.
      locked: run.locked.displayId,
      ai: run.ai?.displayId ?? run.locked.displayId,
      // Edit Image paints over the version shown, at its own proportions.
      sizes: {
        locked: { width: run.locked.width, height: run.locked.height },
        ai: run.ai ? { width: run.ai.width, height: run.ai.height } : { width: run.locked.width, height: run.locked.height },
      },
    }));
  const target = finished.find((result) => result.id === selection.runId) ?? finished.at(-1) ?? null;

  // Keep the newest run in view when one is added, but not on first load.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [count]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 md:px-8">
        <ModeHint session={session} />
        {session.source ? <OriginalCard source={session.source} /> : null}
        {runs.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            number={run.number}
            parent={run.parentRunId ? (byId.get(run.parentRunId) ?? null) : null}
            others={finished.filter((other) => other.id !== run.id)}
            source={session.source}
            title={session.title}
            tool={tool}
            modelLabel={labelOf(run)}
            downloadDefaults={{ downloadFormat: prefs.downloadFormat, jpegQuality: prefs.jpegQuality }}
            selected={finished.length > 0 && selection.action !== 'new' && target?.id === run.id}
            view={viewOf(run.id)}
            onView={setView(run.id)}
            onRefine={(chosen) => {
              setSelection({ action: 'refine', runId: chosen.id });
              setComposerOpen(true);
              setFocusSignal((n) => n + 1);
            }}
          />
        ))}
        <div ref={end} />
      </div>
      <Composer
        sessionId={session.id}
        tool={tool}
        source={session.source}
        canRun={canRun}
        results={finished}
        selection={{ action: selection.action, runId: target?.id ?? null, view: target ? viewForServer(viewOf(target.id)) : null }}
        onSelect={setSelection}
        focusSignal={focusSignal}
        prefs={prefs}
        options={options}
        analysisCost={analysisCost}
        open={composerOpen}
        onOpenChange={setComposerOpen}
      />
    </div>
  );
}
