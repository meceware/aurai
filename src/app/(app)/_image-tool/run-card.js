'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bandage,
  ChevronsUpDown,
  Clapperboard,
  Download,
  ImageUpscale,
  Info,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Palette,
  PencilLine,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ResultCard } from '@/components/result-card';
import { CompareViewer } from '@/components/compare-viewer';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IMAGE_TOOLS } from '@/lib/image-tools';
import { cn } from '@/lib/utils';
import { animateResult } from '../_video-tool/actions';
import { continueInTool, removeRun, rerun } from './actions';
import { DownloadDialog } from './download-dialog';

const media = (id) => `/api/media/${id}`;
const NEUTRAL = { color: 100, light: 100, ev: 0 };
export const DEFAULT_VIEW = { version: 'locked', dials: NEUTRAL };

/** What a card is showing, in the units the server takes: the version, and dials (0–1) when adjusted. */
export function viewForServer(view) {
  const { version, dials } = view ?? DEFAULT_VIEW;
  const adjusted = version === 'locked' && (dials.color !== NEUTRAL.color || dials.light !== NEUTRAL.light || dials.ev !== NEUTRAL.ev);
  return { version, dials: adjusted ? { color: dials.color / 100, light: dials.light / 100, ev: dials.ev } : null };
}
const money = (usd) => `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`;

export const TOOL_ICONS = { enhance: Palette, colorize: Wand2, repair: Bandage, upscale: ImageUpscale };

// What each result is, and where it came from.
function describe(run, tool, parent) {
  if (run.kind === 'followup') return { label: 'Refined', icon: MessageSquareText, origin: parent ? `from #${parent.number}` : null };
  if (run.kind === 'rerun') return { label: 'Repeated', icon: Repeat, origin: parent ? `same as #${parent.number}` : null };
  return { label: tool.resultLabel, icon: TOOL_ICONS[tool.mode] ?? Palette, origin: null };
}

/** What Repair and Upscale did, in a few words: how much was repaired, how large it now is. */
function outcome(run) {
  const fidelity = run.fidelity;
  if (typeof fidelity?.repaired === 'number') {
    const share = fidelity.repaired * 100;
    return share < 0.1 ? 'Nothing needed repair' : `${share < 1 ? '<1' : Math.round(share)}% repaired`;
  }
  if (typeof fidelity?.factor === 'number' && run.locked) return `${run.locked.width}×${run.locked.height} · ${fidelity.factor.toFixed(1)}× larger`;
  return null;
}

function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>;
}

/**
 * How closely the AI redraw kept the photo's structure, from comparing edge maps. Thresholds come
 * from the M0 spike: redraws that kept the face scored 0.96–0.99; a visible redraw scored 0.88.
 */
function Similarity({ fidelity }) {
  if (typeof fidelity?.structure !== 'number') return null;
  const score = fidelity.structure;
  const [verdict, tone, Icon] =
    score >= 0.94
      ? ['Details kept', 'text-success', ShieldCheck]
      : score >= 0.85
        ? ['Some details changed', 'text-warning', AlertTriangle]
        : ['Details changed', 'text-destructive', AlertTriangle];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-secondary px-2 text-xs font-medium whitespace-nowrap tabular-nums">
          <Icon className={cn('size-3', tone)} />
          <span className="max-sm:sr-only">Similarity</span> {Math.round(score * 100)}%
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {verdict}: how closely the AI redraw kept your photo&apos;s edges and details. The Local version always keeps all of your
        photo&apos;s detail.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The Local version with the dials applied, rendered by the server. The new image is swapped in
 * only once the dials have settled and it has loaded, so the viewer never flashes blank.
 */
function useLocalPreview(locked, dials) {
  const neutral = dials.color === NEUTRAL.color && dials.light === NEUTRAL.light && dials.ev === NEUTRAL.ev;
  const target = !locked
    ? null
    : neutral
      ? media(locked.displayId)
      : `${media(locked.id)}/mix?color=${dials.color / 100}&light=${dials.light / 100}&ev=${dials.ev}`;
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (!target || target === shown) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      const image = new Image();
      image.onload = () => !cancelled && setShown(target);
      image.onerror = () => !cancelled && toast.error('Could not update the preview.');
      image.src = target;
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, shown]);

  return { src: shown, loading: Boolean(target) && target !== shown, neutral };
}

function Dial({ label, help, value, min, max, step, format, onChange }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="w-20 shrink-0 cursor-help text-xs text-muted-foreground">{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{help}</TooltipContent>
      </Tooltip>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} aria-label={label} className="flex-1" />
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{format(value)}</span>
    </div>
  );
}

function Adjustments({ dials, onChange, neutral }) {
  const set = (field) => (value) => onChange((current) => ({ ...current, [field]: value }));
  return (
    <div className="grid gap-x-6 gap-y-2.5 border-t pt-3 sm:grid-cols-3">
      <Dial
        label="Color"
        help="How much of the AI's color correction to apply. 0% keeps your photo's own colors."
        value={dials.color}
        min={0}
        max={100}
        step={5}
        format={(v) => `${v}%`}
        onChange={set('color')}
      />
      <Dial
        label="Brightness"
        help="How much of the AI's brightness and contrast change to apply. 0% keeps your photo's own light."
        value={dials.light}
        min={0}
        max={100}
        step={5}
        format={(v) => `${v}%`}
        onChange={set('light')}
      />
      <Dial
        label="Exposure"
        help="Makes the whole result lighter or darker, in photographic stops."
        value={dials.ev}
        min={-1}
        max={1}
        step={0.1}
        format={(v) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)}
        onChange={(ev) => set('ev')(Math.round(ev * 10) / 10)}
      />
      {neutral ? null : (
        <Button size="sm" variant="ghost" className="h-7 w-fit text-muted-foreground sm:col-span-3" onClick={() => onChange(NEUTRAL)}>
          <RotateCcw className="size-3.5" />
          Reset
        </Button>
      )}
    </div>
  );
}

function AnalysisFindings({ analysis }) {
  if (!analysis?.issues?.length && !analysis?.corrections?.length) return null;
  return (
    <details className="group border-t px-1.5 pt-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground select-none group-open:text-foreground">
        <Sparkles className="size-4 text-brand" />
        What the AI noticed
        <span className="text-xs font-normal">· {analysis.issues.length} issues</span>
      </summary>
      <ul className="mt-3 space-y-1.5">
        {analysis.issues.map((issue) => (
          <li key={`${issue.problem}-${issue.where}`} className="flex gap-2">
            <span
              className={cn(
                'mt-1.5 size-1.5 shrink-0 rounded-full',
                issue.severity === 'strong' ? 'bg-destructive' : issue.severity === 'moderate' ? 'bg-warning' : 'bg-muted-foreground',
              )}
            />
            <span>
              {issue.problem} <span className="text-muted-foreground">· {issue.where}</span>
            </span>
          </li>
        ))}
      </ul>
      {analysis.corrections.length ? (
        <p className="mt-3 text-xs text-muted-foreground">Asked the model to: {analysis.corrections.join(' · ')}</p>
      ) : null}
    </details>
  );
}

function CompareWith({ others, against, onChange, current, number }) {
  if (!others.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 max-w-full gap-1 px-2" aria-label="Compare against">
          <span className="truncate">{current ? `#${current.number}` : 'Original'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">vs #{number}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Compare #{number} with</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={against} onValueChange={onChange}>
          <DropdownMenuRadioItem value="original">Original</DropdownMenuRadioItem>
          {others.map((other) => (
            <DropdownMenuRadioItem key={other.id} value={other.id}>
              Result #{other.number} <span className="ml-1 truncate text-xs text-muted-foreground">{other.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * `view` (Local or AI, and the Local dials) lives with the thread, so the composer refines exactly
 * what this card shows; `onView` changes it.
 */
export function RunCard({ run, number, parent, others = [], source, title, tool, selected, onRefine, modelLabel, downloadDefaults, view = DEFAULT_VIEW, onView }) {
  const router = useRouter();
  const VERSIONS = tool.versions;
  // Upscale's free resize has only the Local version.
  const version = run.ai ? view.version : 'locked';
  const { dials } = view;
  const setVersion = (next) => onView((current) => ({ ...current, version: next }));
  const setDials = (next) => onView((current) => ({ ...current, dials: typeof next === 'function' ? next(current.dials) : next }));
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(true);
  const handingOff = useRef(false);
  // Any other finished result can be the "before". A refinement starts compared with what it refined.
  const [against, setAgainst] = useState(run.kind === 'followup' && parent?.locked ? parent.id : 'original');
  const [pending, startTransition] = useTransition();
  const preview = useLocalPreview(run.locked, dials);
  const kind = describe(run, tool, parent);
  const active = run.status === 'queued' || run.status === 'running';
  const done = run.status === 'succeeded' && run.locked;
  const compareWith = against === 'original' ? null : (others.find((other) => other.id === against) ?? null);

  const act = (action, success) =>
    startTransition(async () => {
      const result = await action(run.id);
      if (result?.error) toast.error(result.error);
      else {
        if (success) toast(success);
        router.refresh();
      }
    });

  // Opens Animate, or another image tool, with this result as it is on screen: the version
  // shown, with its adjustments.
  const shown = () => viewForServer({ ...view, version });
  const animate = () =>
    startTransition(async () => {
      const { version: picked, dials: set } = shown();
      const result = await animateResult({ runId: run.id, version: picked, dials: set ?? undefined });
      if (result?.error) toast.error(result.error);
    });
  const continueIn = (mode) =>
    startTransition(async () => {
      const { version: picked, dials: set } = shown();
      const result = await continueInTool({ runId: run.id, version: picked, dials: set ?? undefined, mode });
      if (result?.error) toast.error(result.error);
    });
  const nextTools = Object.values(IMAGE_TOOLS).filter((other) => other.mode !== tool.mode);

  const adjusted = version === 'locked' && !preview.neutral;
  const after = version === 'ai' ? media(run.ai?.displayId ?? run.locked?.displayId) : preview.src;
  const before = media(compareWith ? compareWith[version] : source.displayId);

  return (
    <ResultCard
      id={`result-${number}`}
      selected={selected}
      open={open}
      // A run in progress is not folded away: its status is the point.
      onToggle={active ? null : () => setOpen(!open)}
      thumb={run.locked ? media(run.locked.displayId) : null}
      icon={kind.icon}
      number={number}
      label={kind.label}
      facts={[kind.origin, modelLabel, run.costUsd > 0 ? `(${money(run.costUsd)})` : null].filter(Boolean).join(' · ')}
      instruction={run.instruction}
    >
      {active ? (
        <div className="relative overflow-hidden rounded-md bg-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={media(run.kind === 'followup' && parent?.locked ? parent.locked.displayId : source.displayId)}
            alt=""
            className="mx-auto max-h-[60vh] w-auto object-contain opacity-40 blur-[1px]"
            style={{ aspectRatio: `${source.width} / ${source.height}` }}
          />
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-3 rounded-full border bg-background/85 px-4 py-2 text-sm shadow-lg backdrop-blur">
              <Loader2 className="size-4 animate-spin text-brand" />
              <span>{run.status === 'queued' ? 'Waiting to start…' : run.kind === 'followup' ? 'Refining…' : tool.working}</span>
              {run.startedAt ? (
                <span className="text-muted-foreground">
                  <Elapsed since={run.startedAt} />
                </span>
              ) : null}
              <Button size="sm" variant="ghost" className="-mr-2 h-7 text-muted-foreground" disabled={pending} onClick={() => act(removeRun, 'Stopped')}>
                Stop
              </Button>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-muted/40">
            <div className="h-full w-1/3 animate-[aurai-indeterminate_1.6s_ease-in-out_infinite] rounded-full bg-brand" />
          </div>
        </div>
      ) : run.status === 'failed' ? (
        <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center">
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <p className="flex-1 text-pretty">{run.error || 'This run failed.'}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(rerun)}>
              <Repeat className="size-4" />
              Try again
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(removeRun)} aria-label="Remove">
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ) : done ? (
        <CompareViewer
          before={before}
          beforeLabel={compareWith ? `#${compareWith.number}` : 'Original'}
          after={after}
          afterLabel={`#${number} ${VERSIONS[version].name}${adjusted ? ' · adjusted' : ''}`}
          width={source.width}
          height={source.height}
          center={<CompareWith others={others} against={against} onChange={setAgainst} current={compareWith} number={number} />}
        />
      ) : null}

      {done ? (
        <>
          <div className="space-y-3 rounded-md bg-muted/40 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              {run.ai ? (
                <ToggleGroup type="single" size="sm" variant="outline" value={version} onValueChange={(value) => value && setVersion(value)} aria-label="Version">
                  {Object.entries(VERSIONS).map(([key, value]) => (
                    <ToggleGroupItem key={key} value={key} className="px-3.5">
                      {value.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              ) : (
                <span className="px-1 text-xs text-muted-foreground">Enlarged here, nothing drawn by a model</span>
              )}
              {run.ai ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Local or AI?">
                      <Info className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80 space-y-2">
                    <p>
                      <strong>Local</strong> — {VERSIONS.locked.help}
                    </p>
                    <p>
                      <strong>AI</strong> — {VERSIONS.ai.help}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <Similarity fidelity={run.fidelity} />
              {outcome(run) ? <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">{outcome(run)}</span> : null}

              <div className="ml-auto flex shrink-0 items-center">
                {preview.loading ? <Loader2 className="mr-1 size-4 animate-spin text-muted-foreground" aria-label="Updating preview" /> : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setDownloading(true)} aria-label="Download">
                      <Download className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="size-8" aria-label="More actions">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-48"
                    onCloseAutoFocus={(event) => {
                      // Refine puts the cursor in the composer; the menu must not take it back.
                      if (handingOff.current) event.preventDefault();
                      handingOff.current = false;
                    }}
                  >
                    {tool.refine ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          handingOff.current = true;
                          onRefine(run);
                        }}
                      >
                        <PencilLine className="size-4" />
                        Refine #{number}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem disabled={pending} onSelect={() => act(rerun, `Repeating #${number}`)}>
                      <Repeat className="size-4" />
                      Repeat #{number}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {nextTools.map((other) => {
                      const Icon = TOOL_ICONS[other.mode];
                      return (
                        <DropdownMenuItem key={other.mode} disabled={pending} onSelect={() => continueIn(other.mode)}>
                          <Icon className="size-4" />
                          {other.verb} this
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuItem disabled={pending} onSelect={animate}>
                      <Clapperboard className="size-4" />
                      Animate this
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => act(removeRun, 'Result deleted')}>
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {version === 'locked' && tool.dials ? <Adjustments dials={dials} onChange={setDials} neutral={preview.neutral} /> : null}
          </div>

          <AnalysisFindings analysis={run.analysis} />

          <DownloadDialog
            key={version}
            open={downloading}
            onOpenChange={setDownloading}
            initialVersion={version}
            run={run}
            number={number}
            source={source}
            title={title}
            dials={dials}
            adjusted={!preview.neutral}
            defaults={downloadDefaults}
          />
        </>
      ) : null}
    </ResultCard>
  );
}
