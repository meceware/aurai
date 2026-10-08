'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Clapperboard, Columns2, Download, Film, Loader2, Maximize2, MoreHorizontal, Pause, PencilLine, Play, Repeat, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ResultCard } from '@/components/result-card';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { editClip, removeVideoJob, retryVideo, stopWaiting } from './actions';

const media = (id) => `/api/media/${id}`;
export const isActive = (job) => ['queued', 'submitting', 'pending', 'in_progress', 'downloading'].includes(job.status);

const STATUS = {
  queued: 'Waiting to start…',
  submitting: 'Sending to OpenRouter…',
  pending: 'Queued at OpenRouter…',
  in_progress: 'Making the video…',
  downloading: 'Saving the video…',
};

function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>;
}

const ratioOf = (job) => {
  if (job.video) return `${job.video.width} / ${job.video.height}`;
  const [w, h] = String(job.params.aspect ?? job.params.shape ?? '16:9').split(':');
  return `${w} / ${h}`;
};

/** What a clip is, in one line: model, size, length, sound, price. */
export function clipFacts(job, labels) {
  const facts = [job.label ?? labels[job.model] ?? job.model, job.params.resolution, job.params.duration ? `${job.params.duration} s` : null];
  if (job.params.audio) facts.push('sound');
  if (job.params.anchor) facts.push('anchored');
  if (job.costUsd > 0) facts.push(`(${formatPrice(job.costUsd)})`);
  else if (job.status === 'completed' && job.model.startsWith('local/')) facts.push('(free)');
  return facts.filter(Boolean).join(' · ');
}

function useAct() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (action, id, success) =>
    startTransition(async () => {
      const result = await action(id);
      if (result?.error) toast.error(result.error);
      else {
        if (success) toast(success);
        router.refresh();
      }
    });
  return [act, pending];
}

function ClipMenu({ job, number, onChange }) {
  const [act, pending] = useAct();
  // "Change and try again" moves the cursor to the composer; the menu must not take it back.
  const handingOff = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label="More actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (handingOff.current) event.preventDefault();
          handingOff.current = false;
        }}
      >
        <DropdownMenuItem disabled={pending} onSelect={() => act(retryVideo, job.id, `Trying #${number} again`)}>
          <Repeat className="size-4" />
          Try again
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            handingOff.current = true;
            onChange(job);
          }}
        >
          <PencilLine className="size-4" />
          Change and try again
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={() => {
            // Copying the clip in takes a few seconds; the page then moves to Edit Video.
            toast('Opening the clip in Edit Video…');
            act(editClip, job.id);
          }}
        >
          <Film className="size-4" />
          Edit this clip
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => act(removeVideoJob, job.id, 'Clip deleted')}>
          <Trash2 className="size-4" />
          Delete clip
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The model is in the file name, so downloaded clips can still be told apart.
const downloadUrl = (job, title, number, labels) => `${media(job.video.id)}?download=1&name=${slug(`${title}-${number}-${job.label ?? labels[job.model] ?? job.model}`).slice(0, 80)}`;
const megabytes = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB` : null);

function DownloadClip({ job, title, number, labels }) {
  if (!job.video) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild size="icon" variant="ghost" className="size-8">
          <a href={downloadUrl(job, title, number, labels)} aria-label="Download">
            <Download className="size-4" />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Download MP4</TooltipContent>
    </Tooltip>
  );
}

/**
 * The picture area of a clip: the video once it exists; until then its first frame, with what
 * is happening; or what went wrong.
 */
function ClipMedia({ job, videoRef, controls = true, compact = false }) {
  const [act, pending] = useAct();
  const style = { aspectRatio: ratioOf(job) };

  if (job.status === 'completed' && job.video) {
    return (
      <video
        ref={videoRef}
        src={media(job.video.id)}
        poster={job.posterId ? media(job.posterId) : undefined}
        controls={controls}
        playsInline
        loop={controls}
        muted={!controls}
        preload="metadata"
        className={cn('mx-auto w-auto rounded-md bg-stage object-contain', compact ? 'max-h-[50vh]' : 'max-h-[70vh]')}
        style={style}
      />
    );
  }

  if (isActive(job)) {
    return (
      <div className="relative mx-auto overflow-hidden rounded-md bg-stage" style={{ ...style, maxHeight: compact ? '50vh' : '70vh' }}>
        {job.posterId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media(job.posterId)} alt="" className="size-full object-contain opacity-40 blur-[1px]" />
        ) : null}
        <div className="absolute inset-0 grid place-items-center p-3">
          <div className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border bg-background/85 px-4 py-2 text-sm shadow-lg backdrop-blur', compact && 'px-3 text-xs')}>
            <Loader2 className="size-4 animate-spin text-brand" />
            <span>{STATUS[job.status]}</span>
            <span className="text-muted-foreground">
              <Elapsed since={job.submittedAt ?? job.createdAt} />
            </span>
            <Button size="sm" variant="ghost" className="-mr-2 h-7 text-muted-foreground" disabled={pending} onClick={() => act(stopWaiting, job.id, 'Stopped waiting')}>
              Stop waiting
            </Button>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-muted/40">
          <div className="h-full w-1/3 animate-[aurai-indeterminate_1.6s_ease-in-out_infinite] rounded-full bg-brand" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm',
        // In a comparison the tile keeps the clip's shape, so the grid stays even.
        compact ? 'flex-col items-center justify-center text-center' : 'flex-col sm:flex-row sm:items-center',
      )}
      style={compact ? { aspectRatio: ratioOf(job), maxHeight: '50vh' } : undefined}
    >
      <AlertTriangle className="size-5 shrink-0 text-destructive" />
      <p className={cn('text-pretty', !compact && 'flex-1')}>{job.error || `This clip ${job.status === 'abandoned' ? 'was stopped' : 'failed'}.`}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act(retryVideo, job.id)}>
          <Repeat className="size-4" />
          Try again
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(removeVideoJob, job.id)} aria-label="Remove">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Every clip of a comparison, each with what it is, so the right one is downloaded. */
function DownloadClips({ jobs, number, title, labels, open, onOpenChange }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Download from #{number}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>MP4 files, named after the model that made them.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              {job.posterId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media(job.posterId)} alt="" className="size-12 shrink-0 rounded object-cover" />
              ) : null}
              <span className="grid min-w-0 flex-1 gap-0.5 text-sm">
                <span className="truncate font-medium">{job.label ?? labels[job.model] ?? job.model}</span>
                <span className="text-xs text-muted-foreground">
                  {job.video
                    ? [`${job.video.width}×${job.video.height}`, job.video.duration ? `${Math.round(job.video.duration)} s` : null, megabytes(job.video.bytes)].filter(Boolean).join(' · ')
                    : isActive(job)
                      ? 'Still being made'
                      : 'Not made'}
                </span>
              </span>
              {job.video ? (
                <Button asChild size="sm" variant="outline">
                  <a href={downloadUrl(job, title, number, labels)}>
                    <Download className="size-4" />
                    Download
                  </a>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** One clip. */
export function ClipCard({ job, number, origin, labels, presets, title, onChange, selected }) {
  const [open, setOpen] = useState(true);
  return (
    <ResultCard
      id={`clip-${number}`}
      selected={selected}
      open={open}
      onToggle={isActive(job) ? null : () => setOpen(!open)}
      thumb={job.posterId ? media(job.posterId) : null}
      icon={Clapperboard}
      number={number}
      label={presets[job.preset]?.label ?? (job.params.tool === 'edit' ? 'Edit' : 'Clip')}
      facts={[origin, clipFacts(job, labels)].filter(Boolean).join(' · ')}
      instruction={job.instruction}
    >
      <ClipMedia job={job} />
      {job.status === 'completed' ? (
        <div className="flex items-center justify-end gap-1 rounded-md bg-muted/40 px-2 py-1">
          <span className="mr-auto text-xs text-muted-foreground">
            {job.video?.width}×{job.video?.height}
            {job.params.aspect ? ` · ${job.params.aspect}` : ''}
          </span>
          <DownloadClip job={job} title={title} number={number} labels={labels} />
          <ClipMenu job={job} number={number} onChange={onChange} />
        </div>
      ) : null}
    </ResultCard>
  );
}

/**
 * Plays several clips as one: a single play/pause and scrubber for all of them, kept in step
 * against the longest. Shorter clips hold their last frame until the longest one ends.
 */
function useSyncedPlayback(count) {
  const refs = useRef([]);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);

  const videos = useCallback(() => refs.current.slice(0, count).filter(Boolean), [count]);
  const leader = useCallback(() => videos().reduce((best, video) => (!best || (video.duration || 0) > (best.duration || 0) ? video : best), null), [videos]);

  useEffect(() => {
    if (!playing) return undefined;
    let frame;
    const step = () => {
      const lead = leader();
      if (lead) {
        const t = lead.currentTime;
        setTime(t);
        for (const video of videos()) {
          if (video === lead) continue;
          const target = Math.min(t, (video.duration || t) - 0.05);
          if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = Math.max(0, target);
        }
        if (lead.ended) {
          for (const video of videos()) video.currentTime = 0;
          for (const video of videos()) video.play().catch(() => {});
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, leader, videos]);

  const toggle = () => {
    const all = videos();
    if (!all.length) return;
    if (playing) all.forEach((video) => video.pause());
    else all.forEach((video) => video.play().catch(() => {}));
    setPlaying(!playing);
  };
  const seek = (t) => {
    for (const video of videos()) video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.05));
    setTime(t);
  };
  const onLoaded = () => setLength(Math.max(0, ...videos().map((video) => video.duration || 0)));

  return { refs, playing, time, length, toggle, seek, onLoaded };
}

/** Clips from several models, made from the same photo and settings, side by side. */
export function CompareCard({ jobs, number, origin, labels, presets, title, onChange, selected }) {
  const [open, setOpen] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const first = jobs[0];
  const ready = jobs.filter((job) => job.status === 'completed' && job.video);
  const sync = useSyncedPlayback(jobs.length);
  const portrait = first.params.aspect && Number(first.params.aspect.split(':')[0]) < Number(first.params.aspect.split(':')[1]);

  return (
    <ResultCard
      id={`clip-${number}`}
      selected={selected}
      open={open}
      onToggle={jobs.every(isActive) ? null : () => setOpen(!open)}
      thumb={first.posterId ? media(first.posterId) : null}
      icon={Columns2}
      number={number}
      label={`Compare · ${presets[first.preset]?.label ?? (first.params.tool === 'edit' ? 'Edit' : 'Clip')}`}
      facts={[origin, `${jobs.length} models: ${jobs.map((job) => job.label ?? labels[job.model] ?? job.model).join(', ')}`].filter(Boolean).join(' · ')}
      instruction={first.instruction}
    >
      <div className={cn('grid gap-3', portrait ? (jobs.length === 3 ? 'grid-cols-3' : jobs.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2') : 'sm:grid-cols-2')}>
        {jobs.map((job, index) => (
          <figure key={job.id} className="min-w-0 space-y-1.5">
            <figcaption className="flex min-w-0 items-center gap-1 text-xs">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{job.label ?? labels[job.model] ?? job.model}</span>
                <span className="text-muted-foreground"> · {[job.params.resolution, job.params.duration && `${job.params.duration} s`, job.costUsd > 0 ? formatPrice(job.costUsd) : job.model.startsWith('local/') ? 'free' : null].filter(Boolean).join(' · ')}</span>
              </span>
              {job.status === 'completed' ? (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label="Full screen"
                    onClick={() => sync.refs.current[index]?.requestFullscreen?.()}
                  >
                    <Maximize2 className="size-3.5" />
                  </Button>
                  <ClipMenu job={job} number={number} onChange={onChange} />
                </>
              ) : null}
            </figcaption>
            <ClipMedia
              job={job}
              compact
              controls={false}
              videoRef={(element) => {
                sync.refs.current[index] = element;
                if (!element) return;
                element.onloadedmetadata = sync.onLoaded;
                // A cached clip may have its metadata before this handler is attached.
                if (element.readyState >= 1) queueMicrotask(sync.onLoaded);
              }}
            />
          </figure>
        ))}
      </div>
      {ready.length ? (
        <div className="flex items-center gap-3 rounded-md bg-muted/40 px-2 py-1">
          <Button size="icon" variant="ghost" className="size-8" onClick={sync.toggle} aria-label={sync.playing ? 'Pause all' : 'Play all'}>
            {sync.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Slider
            value={[sync.time]}
            min={0}
            max={sync.length || 1}
            step={0.04}
            onValueChange={([value]) => sync.seek(value)}
            aria-label="Position in all clips"
            className="flex-1"
          />
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {sync.time.toFixed(1)} / {sync.length.toFixed(1)} s
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => setDownloading(true)} aria-label="Download clips">
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download clips</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      <DownloadClips jobs={jobs} number={number} title={title} labels={labels} open={downloading} onOpenChange={setDownloading} />
    </ResultCard>
  );
}
