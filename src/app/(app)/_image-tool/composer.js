'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, Brush, ChevronDown, ChevronsUpDown, ChevronUp, Loader2, X } from 'lucide-react';
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
  ResponsiveDialogTrigger,
} from '@/components/responsive-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatDuration, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { rerun, startRun } from './actions';
import { Painter } from './painter';

const media = (id) => `/api/media/${id}`;

/** The three ways to continue, in the words a person would use. */
/** Which picture a refinement starts from: whatever the result's card is showing. */
function refineSource(tool, view, n) {
  if (tool.mode === 'edit') return view?.version === 'ai' ? `the whole image of ${n}` : n;
  if (view?.version === 'ai') return `the AI redraw of ${n}`;
  return `the Local version of ${n}${view?.dials ? ', with your adjustments' : ''}`;
}

function choices(tool, target, view) {
  const n = target ? `#${target.number}` : '';
  const all = [
    {
      value: 'refine',
      title: `Refine ${n}`,
      description: `Edit ${refineSource(tool, view, n)}. Only what you describe changes; everything else in it stays as it is.`,
      needsTarget: true,
    },
    {
      value: 'new',
      title: 'Start over',
      description: `A new attempt on your original photo, with your text and the model below. Earlier results stay.`,
    },
    {
      value: 'repeat',
      title: `Repeat ${n}`,
      description: `Do what ${n} did again — same starting image, text and model — for a different take.`,
      needsTarget: true,
    },
  ];
  // Upscale's results are not refined: there is nothing to describe beyond "bigger".
  return tool.refine ? all : all.filter((choice) => choice.value !== 'refine');
}

function TargetPicker({ results, value, onChange }) {
  const current = results.find((result) => result.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
          Working on result #{current?.number}
          <ChevronsUpDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Which result</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {results.map((result) => (
            <DropdownMenuRadioItem key={result.id} value={result.id}>
              Result #{result.number}
              <span className="ml-1 truncate text-xs text-muted-foreground">{result.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Edit Image's painted area: a button to paint one, then what is painted, to change or drop. */
function PaintButton({ paint, onPaint, onRemove, disabled }) {
  if (!paint) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-9" onClick={onPaint} disabled={disabled}>
        <Brush className="size-4" />
        Paint an area
      </Button>
    );
  }
  return (
    <span className="inline-flex h-9 items-center rounded-md border border-brand/50 bg-brand/10 text-sm">
      <button type="button" className="flex h-full items-center gap-1.5 rounded-l-md pr-1 pl-2.5 hover:bg-brand/15" onClick={onPaint} disabled={disabled}>
        <Brush className="size-4 text-brand" />
        Painted area
        <span className="text-xs text-muted-foreground tabular-nums">{paint.share < 0.01 ? '<1' : Math.round(paint.share * 100)}%</span>
      </button>
      <button type="button" className="grid h-full place-items-center rounded-r-md px-2 hover:bg-brand/15" onClick={onRemove} disabled={disabled} aria-label="Remove the painted area">
        <X className="size-3.5" />
      </button>
    </span>
  );
}

export function Composer({ sessionId, tool, source, canRun, results, selection, onSelect, focusSignal, prefs, options, analysisCost = 0, open, onOpenChange }) {
  const router = useRouter();
  const preferred = prefs?.[`${tool.mode}Model`];
  const [model, setModel] = useState(options.some((o) => o.id === preferred) ? preferred : options[0]?.id);
  const [confirming, setConfirming] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [pending, startTransition] = useTransition();
  const box = useRef(null);
  // Edit Image: what is painted, and over which image (`over.key`); the painter while it is open.
  const [paint, setPaint] = useState(null);
  const [painting, setPainting] = useState(false);

  const hasResults = results.length > 0;
  const target = results.find((result) => result.id === selection.runId) ?? results.at(-1) ?? null;
  const action = hasResults ? selection.action : 'new';
  const repeating = action === 'repeat';
  // Repeating uses the earlier run's model; the cost shown should be that one's.
  const find = (id) => options.find((candidate) => candidate.id === id);
  const chosen = repeating ? (find(target?.model) ?? { label: target?.label, cost: null }) : (find(model) ?? options[0]);

  // A refinement is painted over the version its card shows; anything else over the photo.
  const refineVersion = selection.view?.version === 'ai' ? 'ai' : 'locked';
  const over =
    action === 'refine' && target
      ? { key: `${target.id}:${refineVersion}`, src: media(target[refineVersion]), ...target.sizes[refineVersion] }
      : source
        ? { key: source.id, src: media(source.displayId), width: source.width, height: source.height }
        : null;
  const canPaint = Boolean(tool.paint && over && !repeating);
  // Painted over another image than this run would start from: not used, and not shown.
  const painted = canPaint && paint?.over === over.key ? paint : null;

  // "Refine" on a result card lands here, ready to describe the change.
  useEffect(() => {
    if (!focusSignal) return undefined;
    // After the menu that asked for it has closed and let go of the focus.
    const timer = setTimeout(() => box.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [focusSignal]);

  // The free resize runs here: it needs no key, and takes no text.
  const local = Boolean(chosen?.local);
  const blocked =
    (!canRun && !local) ||
    pending ||
    !chosen ||
    ((action === 'refine' || (tool.needsText && !repeating)) && !instruction.trim()) ||
    ((action === 'refine' || repeating) && !target);

  // Refinements skip the analysis; everything else pays for it when it is on.
  const estimate = (chosen?.cost ?? 0) + (action === 'refine' ? 0 : analysisCost);
  const known = typeof chosen?.cost === 'number';

  const submit = (event, { confirmed = false } = {}) => {
    event?.preventDefault();
    if (blocked) return;
    // Ask first when it may cost more than the person's limit — including when nobody knows yet.
    if (!confirmed && !local && prefs?.confirmAbove > 0 && (!known || estimate > prefs.confirmAbove)) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const result = repeating
        ? await rerun(target.id)
        : await startRun({
            sessionId,
            model,
            instruction,
            parentRunId: action === 'refine' ? target.id : null,
            from: action === 'refine' ? (selection.view?.version ?? 'locked') : undefined,
            dials: action === 'refine' ? (selection.view?.dials ?? undefined) : undefined,
            mask: painted?.dataUrl ?? null,
          });
      if (result?.error) return toast.error(result.error);
      if (!repeating) setInstruction('');
      setPaint(null);
      router.refresh();
    });
  };

  const button = action === 'refine' ? `Refine #${target?.number}` : repeating ? `Repeat #${target?.number}` : tool.verb;
  const placeholder = local
    ? 'Resize only enlarges your photo here; it takes no text'
    : repeating
      ? target?.instruction
        ? `Uses #${target.number}'s text: “${target.instruction}”`
        : `Uses #${target?.number}'s settings, with no extra text`
      : painted
        ? 'What to do in the painted area, e.g. “remove it”, “a red cap”'
        : action === 'refine'
        ? tool.mode === 'repair'
          ? 'Describe what is left to repair, e.g. “the scratch on the left”'
          : tool.mode === 'edit'
          ? 'What to change next, e.g. “make the cap blue”'
          : 'Describe the change, e.g. “a little darker”, “less yellow in the sky”'
        : tool.placeholder;

  if (!open) {
    return (
      <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-3 pb-3 md:px-8">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg hover:bg-accent/60"
        >
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{button}</span>
          <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">Show the composer</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-6 pb-4 md:px-8">
      <form onSubmit={submit} className="mx-auto w-full max-w-4xl rounded-2xl border bg-card p-2 shadow-lg">
        {canRun ? null : (
          <p className="px-2 pt-1 pb-2 text-sm text-muted-foreground">
            <Link href="/settings" className="font-medium text-foreground underline underline-offset-2">
              Add your OpenRouter key
            </Link>{' '}
            to use {tool.title}{tool.mode === 'upscale' ? ' with AI models. Resize only works without one' : ''}.
          </p>
        )}

        <Textarea
          ref={box}
          value={repeating || local ? '' : instruction}
          disabled={repeating || local}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event);
          }}
          placeholder={placeholder}
          maxLength={500}
          rows={1}
          className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 disabled:opacity-70 dark:bg-transparent"
          aria-label="Instructions"
        />

        {hasResults ? (
          <div className="mx-1 mt-1 border-t pt-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">How to continue</span>
              {action !== 'new' && results.length > 1 ? (
                <TargetPicker results={results} value={target?.id} onChange={(runId) => onSelect({ action, runId })} />
              ) : null}
            </div>
            {/* On a phone only the titles show, side by side, so the composer leaves room for the photo. */}
            <RadioGroup
              value={action}
              onValueChange={(value) => onSelect({ action: value, runId: target?.id })}
              className="mt-1 grid-cols-3 gap-1 sm:grid-cols-1 sm:gap-0.5"
            >
              {choices(tool, target, selection.view).map((choice) => (
                <Label
                  key={choice.value}
                  htmlFor={`continue-${choice.value}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 font-normal transition-colors hover:bg-accent/60 sm:items-start sm:gap-3',
                    action === choice.value && 'bg-accent',
                  )}
                >
                  <RadioGroupItem id={`continue-${choice.value}`} value={choice.value} className="sm:mt-0.5" />
                  <span className="grid gap-0.5 text-sm sm:flex sm:items-baseline sm:gap-2">
                    <span className="font-medium whitespace-nowrap">{choice.title}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{choice.description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-2 px-1 pt-1">
          {canPaint ? <PaintButton paint={painted} onPaint={() => setPainting(true)} onRemove={() => setPaint(null)} disabled={pending} /> : null}
          {repeating ? (
            <span className="px-2 text-sm text-muted-foreground">{chosen?.label}</span>
          ) : options.length ? (
            <ModelPicker options={options} value={model} onChange={setModel} disabled={pending} />
          ) : (
            <Link href="/settings?tab=models" className="px-2 text-sm font-medium underline underline-offset-2">
              Choose a model in Settings
            </Link>
          )}
          <span className="ml-auto hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {[
              local ? 'Free' : known ? `${chosen.approximate ? '≈ ' : ''}${formatPrice(estimate)}` : 'Price after first run',
              chosen?.resolution,
              chosen?.seconds ? formatDuration(chosen.seconds) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <Button type="button" size="icon" variant="ghost" className="size-9 text-muted-foreground" onClick={() => onOpenChange(false)} aria-label="Hide the composer">
            <ChevronDown className="size-4" />
          </Button>
          <Button type="submit" disabled={blocked}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            {button}
          </Button>
        </div>
      </form>

      {painting && over ? (
        <Painter
          image={over}
          initial={painted?.dataUrl ?? null}
          onClose={() => setPainting(false)}
          onDone={(result) => {
            setPaint(result ? { ...result, over: over.key } : null);
            setPainting(false);
            box.current?.focus();
          }}
        />
      ) : null}

      <ResponsiveDialog open={confirming} onOpenChange={setConfirming}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{known ? `Start this run for about ${formatPrice(estimate)}?` : `Start a first run with ${chosen?.label}?`}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {known
                ? `${chosen?.label} is estimated at ${formatPrice(estimate)}, above the ${formatPrice(prefs?.confirmAbove ?? 0)} you set in Settings.`
                : `OpenRouter bills ${chosen?.label} by the amount of image it draws, so its price is known only once it has run. Later runs show it.`}{' '}
              It is billed to your OpenRouter account.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </ResponsiveDialogClose>
            <Button onClick={() => submit(null, { confirmed: true })}>{button}</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
