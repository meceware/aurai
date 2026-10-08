'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUp, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ModelPicker } from '@/components/model-picker';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { discardPhoto, startBatch } from './actions';

const media = (id) => `/api/media/${id}`;
const isActive = (photo) => photo.run?.status === 'queued' || photo.run?.status === 'running';

/** While any photo is being worked on, asks for their statuses every few seconds and re-renders on a change. */
function useBatchPolling(photos) {
  const router = useRouter();
  const active = photos.some(isActive);
  const ids = photos.map((photo) => photo.id).join(',');
  // The runs as the page shows them, in the order the server lists them: by photo, then by age.
  const signature = photos.flatMap((photo) => (photo.run ? [`${photo.run.id}:${photo.run.status}`] : [])).join(',');

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/activity?sessions=${ids}`, { cache: 'no-store' });
        if (!response.ok) return;
        const { runs } = await response.json();
        if (runs.map((run) => `${run.id}:${run.status}`).join(',') !== signature) router.refresh();
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [active, ids, signature, router]);

  // Say so when the last one finishes, including to someone who switched tabs meanwhile.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      const failed = photos.filter((photo) => photo.run?.status === 'failed').length;
      if (failed) toast.error(`${failed} of ${photos.length} photos failed`, { description: 'Open one to see why, and try it again there.' });
      else toast.success(`All ${photos.length} photos are ready`);
    }
    wasActive.current = active;
  }, [active, photos]);
}

const STATUS = {
  queued: { text: 'Waiting', icon: Loader2, spin: false },
  running: { text: 'Working…', icon: Loader2, spin: true },
  failed: { text: 'Failed', icon: AlertTriangle, spin: false },
  // "Ready", not "Done": done is what a person marks a photo as, in the history.
  succeeded: { text: 'Ready', icon: Check, spin: false },
};

function Tile({ photo, tool, started, onDiscard, discarding }) {
  const status = photo.run ? STATUS[photo.run.status] : null;
  const picture = photo.run?.result ?? photo.source?.displayId;
  return (
    <div className="group relative">
      <Link
        href={`${tool.path}/${photo.id}`}
        prefetch={false}
        className="grid gap-1.5 rounded-lg p-1 transition-colors hover:bg-accent/40"
        title={photo.run?.error ?? undefined}
      >
        <span className="relative block overflow-hidden rounded-md bg-stage ring-1 ring-border group-hover:ring-brand/60">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media(picture)} alt="" className={cn('aspect-[4/5] w-full object-cover', isActive(photo) && 'opacity-50')} />
          ) : (
            <span className="block aspect-[4/5]" />
          )}
          {status ? (
            <span
              className={cn(
                'absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-xs backdrop-blur',
                photo.run.status === 'failed' && 'text-destructive',
                photo.run.status === 'succeeded' && 'text-success',
              )}
            >
              <status.icon className={cn('size-3', status.spin && 'animate-spin')} />
              {status.text}
            </span>
          ) : null}
        </span>
        <span className="truncate px-0.5 text-sm">{photo.title}</span>
      </Link>
      {started ? null : (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute top-2 right-2 size-7 rounded-full opacity-90 shadow"
          onClick={() => onDiscard(photo)}
          disabled={discarding}
          aria-label={`Remove ${photo.title}`}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * Several photos started together: before, a grid of them with one composer for all; after, the
 * same grid showing how each one is doing. Each is an ordinary photo of the tool, opened by a click.
 */
export function BatchStudio({ tool, photos, options, prefs, canRun, analysisCost = 0 }) {
  const router = useRouter();
  useBatchPolling(photos);
  const started = photos.some((photo) => photo.run);
  const first = options[photos[0]?.id] ?? [];
  const preferred = prefs?.[`${tool.mode}Model`];
  const [model, setModel] = useState(first.some((option) => option.id === preferred) ? preferred : first[0]?.id);
  const [instruction, setInstruction] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const chosen = first.find((option) => option.id === model) ?? first[0];
  const local = Boolean(chosen?.local);
  // The price of each photo at its own size, added up.
  const costs = photos.map((photo) => options[photo.id]?.find((option) => option.id === chosen?.id)?.cost);
  const known = costs.every((cost) => typeof cost === 'number');
  const total = costs.reduce((sum, cost) => sum + (cost ?? 0), 0) + (local ? 0 : analysisCost * photos.length);
  const approximate = photos.some((photo) => options[photo.id]?.find((option) => option.id === chosen?.id)?.approximate);
  const blocked = (!canRun && !local) || pending || !chosen;

  const discard = (photo) =>
    startTransition(async () => {
      const result = await discardPhoto(photo.id);
      if (result?.error) return toast.error(result.error);
      const rest = photos.filter((other) => other.id !== photo.id);
      if (rest.length === 1) router.replace(`${tool.path}/${rest[0].id}`);
      else if (!rest.length) router.replace(tool.path);
      else router.replace(`${tool.path}/batch?ids=${rest.map((other) => other.id).join(',')}`);
    });

  const start = (event, { confirmed = false } = {}) => {
    event?.preventDefault();
    if (blocked) return;
    if (!confirmed && !local && prefs?.confirmAbove > 0 && (!known || total > prefs.confirmAbove)) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const result = await startBatch({ sessionIds: photos.map((photo) => photo.id), model: chosen.id, instruction: local ? '' : instruction });
      if (result?.error) return toast.error(result.error);
      router.refresh();
    });
  };

  const verb = `${tool.verb} ${photos.length} photos`;
  const counts = photos.reduce((all, photo) => ({ ...all, [photo.run?.status ?? 'none']: (all[photo.run?.status ?? 'none'] ?? 0) + 1 }), {});
  const price = local ? 'Free' : known ? `${approximate ? '≈ ' : ''}${formatPrice(total)}` : 'Price after a first run';

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-6 md:px-8">
        <p className="text-sm text-muted-foreground">
          {started
            ? `${counts.succeeded ?? 0} of ${photos.length} ready${counts.failed ? ` · ${counts.failed} failed` : ''}${counts.running || counts.queued ? ` · ${(counts.running ?? 0) + (counts.queued ?? 0)} to go` : ''}. Each photo is in your ${tool.title} history; open one to see it larger${tool.refine ? ', compare or refine it' : ' or compare it'}.`
            : `These photos will all be made with the model and text below. Remove any you do not want.`}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {photos.map((photo) => (
            <Tile key={photo.id} photo={photo} tool={tool} started={started} onDiscard={discard} discarding={pending} />
          ))}
        </div>
      </div>

      {started ? null : (
        <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-6 pb-4 md:px-8">
          <form onSubmit={start} className="mx-auto w-full max-w-5xl rounded-2xl border bg-card p-2 shadow-lg">
            {canRun || local ? null : (
              <p className="px-2 pt-1 pb-2 text-sm text-muted-foreground">
                <Link href="/settings" className="font-medium text-foreground underline underline-offset-2">
                  Add your OpenRouter key
                </Link>{' '}
                to use {tool.title}.
              </p>
            )}
            <Textarea
              value={local ? '' : instruction}
              disabled={local}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) start(event);
              }}
              placeholder={local ? 'Resize only enlarges your photos here; it takes no text' : `${tool.placeholder} — for every photo`}
              maxLength={500}
              rows={1}
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 disabled:opacity-70 dark:bg-transparent"
              aria-label="Instructions for every photo"
            />
            <div className="mt-1 flex flex-wrap items-center gap-2 px-1 pt-1">
              {first.length ? (
                <ModelPicker options={first} value={chosen?.id} onChange={setModel} disabled={pending} />
              ) : (
                <Link href="/settings?tab=models" className="px-2 text-sm font-medium underline underline-offset-2">
                  Choose a model in Settings
                </Link>
              )}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {photos.length} photos · {price}
              </span>
              <Button type="submit" disabled={blocked}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                {verb}
              </Button>
            </div>
          </form>
        </div>
      )}

      <ResponsiveDialog open={confirming} onOpenChange={setConfirming}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{known ? `Start ${photos.length} runs for about ${formatPrice(total)}?` : `Start ${photos.length} runs with ${chosen?.label}?`}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {known
                ? `${chosen?.label} on ${photos.length} photos is estimated at ${formatPrice(total)} in total, above the ${formatPrice(prefs?.confirmAbove ?? 0)} you set in Settings.`
                : `OpenRouter bills ${chosen?.label} by the amount of image it draws, so its price is known only once it has run.`}{' '}
              It is billed to your OpenRouter account.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </ResponsiveDialogClose>
            <Button onClick={() => start(null, { confirmed: true })}>{verb}</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
