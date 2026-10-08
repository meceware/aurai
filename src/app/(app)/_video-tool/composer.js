'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, ChevronDown, ChevronsUpDown, ChevronUp, Loader2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatDuration, formatPrice, priceLabel } from '@/lib/format';
import { MOTION_PRESETS } from '@/lib/prompts/defaults';
import { DURATIONS, LOCAL_MOTION, planClip, VIDEO_TARGETS } from '@/lib/video-pricing';
import { cn } from '@/lib/utils';
import { startVideo, startVideoEdit } from './actions';

const MAX_COMPARE = 4;

/**
 * What the composer opens with: the models and settings of this session's last clip, else of the
 * last clip made anywhere with the tool, else the defaults — keeping only models that can still
 * be picked.
 */
export function initialComposerState(prefs, profiles, lastGroup = null, tool = 'animate') {
  const known = new Set(profiles.map((profile) => profile.id));
  const last = tool === 'edit' ? prefs.lastEdit : prefs.lastVideo;
  const usable = (ids) => (ids ?? []).filter((id) => known.has(id));
  const fromSession = usable(lastGroup?.map((job) => job.option));
  const fromLast = usable(last?.models);
  const fallback = tool === 'animate' && known.has(prefs.videoModel) ? prefs.videoModel : (profiles[0]?.id ?? LOCAL_MOTION);
  return {
    preset: [lastGroup?.[0]?.preset, last?.preset, prefs.videoPreset].find((key) => Object.hasOwn(MOTION_PRESETS, key)) ?? 'parallax-in',
    instruction: '',
    models: fromSession.length ? fromSession : fromLast.length ? fromLast : [fallback],
    resolution: last?.resolution ?? prefs.videoResolution,
    duration: last?.duration ?? prefs.videoDuration,
    audio: last?.audio ?? prefs.videoAudio,
    parent: null,
  };
}

/**
 * The controls a model offers for keeping people still, from its catalog entry: a negative
 * prompt, and a last frame (which the anchored ending in Settings uses).
 */
function Controls({ profile }) {
  const controls = [profile.negative ? 'takes a negative prompt' : null, profile.lastFrame ? 'can end on your photo' : null].filter(Boolean);
  return <span className="text-xs text-muted-foreground">{controls.length ? `Stillness controls: ${controls.join(', ')}` : 'No stillness controls: the prompt only'}</span>;
}

// The chooser in two parts. Animate: AI video models, and the flat zoom made here. Edit Video:
// models made to change a video, and models that make a new one with the video as a guide.
const GROUPS = {
  animate: [
    { key: 'video', title: 'Video models', has: (profile) => !profile.local },
    { key: 'local', title: 'Made local', has: (profile) => profile.local },
  ],
  edit: [
    { key: 'edit', title: 'Video editors', note: 'Change your video and keep the rest of it.', has: (profile) => !profile.frames },
    { key: 'guided', title: 'Guided by your video', note: 'Make a new video that follows yours, so more can change.', has: (profile) => profile.frames },
  ],
};

function ModelItem({ profile, plan, checked, onToggle, canRun, motion, editing }) {
  const blocked = !profile.local && !canRun;
  const facts = [profile.provider, plan.resolution, `${plan.duration} s`, plan.aspect, profile.seconds ? formatDuration(profile.seconds) : null];
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      disabled={blocked}
      onCheckedChange={(on) => onToggle(profile.id, on)}
      onSelect={(event) => event.preventDefault()}
      className="items-start rounded-lg py-2"
    >
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{profile.label}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {plan.cost === 0 ? 'Free' : priceLabel(plan)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{facts.filter(Boolean).join(' · ')}</span>
        {profile.local ? (
          <span className="text-xs text-muted-foreground">Made from the photo itself, so nothing is invented: {motion.localMotion}.</span>
        ) : editing ? null : (
          <Controls profile={profile} />
        )}
        {blocked ? <span className="text-xs text-muted-foreground">Needs your OpenRouter key</span> : null}
        {profile.caveat ? (
          <span className="flex items-center gap-1 text-xs text-warning">
            <TriangleAlert className="size-3" />
            {profile.caveat}
          </span>
        ) : null}
      </div>
    </DropdownMenuCheckboxItem>
  );
}

/** Choosing models: one makes a clip; several make a side-by-side comparison. */
function ModelChooser({ profiles, chosen, plans, onChange, canRun, disabled, motion, editing }) {
  const only = chosen.length === 1 ? profiles.find((profile) => profile.id === chosen[0]) : null;
  const label = only ? only.label : `${chosen.length} models`;
  const toggle = (id, on) => {
    const next = on ? [...chosen, id] : chosen.filter((value) => value !== id);
    if (!next.length) return;
    if (next.length > MAX_COMPARE) return toast.error(`Compare up to ${MAX_COMPARE} at a time.`);
    onChange(next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button type="button" variant="outline" size="sm" className="max-w-56 gap-1.5" aria-label={`Models: ${label}`}>
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] p-1.5">
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Pick one, or up to {MAX_COMPARE} to compare side by side.</p>
        {GROUPS[editing ? 'edit' : 'animate'].map((group) => {
          const members = profiles.filter(group.has);
          if (!members.length) return null;
          return (
            <DropdownMenuGroup key={group.key}>
              <DropdownMenuSeparator className="first:hidden" />
              <DropdownMenuLabel className="pb-0.5 text-xs font-medium">{group.title}</DropdownMenuLabel>
              {group.note ? <p className="px-2 pb-1 text-xs text-muted-foreground">{group.note}</p> : null}
              {members.map((profile) => (
                <ModelItem
                  key={profile.id}
                  profile={profile}
                  plan={plans.get(profile.id)}
                  checked={chosen.includes(profile.id)}
                  onToggle={toggle}
                  canRun={canRun}
                  motion={motion}
                  editing={editing}
                />
              ))}
            </DropdownMenuGroup>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-xs text-muted-foreground">
          <Link href="/settings?tab=models">{editing ? 'Choose Edit Video models in Settings' : 'Choose video models in Settings'}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Choice({ value, onChange, options, label, disabled, format = (v) => v }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(typeof options[0] === 'number' ? Number(next) : next)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-8 gap-1 px-2.5 text-sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {format(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * `state` lives with the page, so "Change and try again" on a clip can load that clip's settings
 * here; `focusSignal` then puts the cursor in the text box. With `tool="edit"` it changes a video
 * by a prompt: no motion, the length is the video's own, and the words are required.
 */
export function VideoComposer({ tool = 'animate', sessionId, source, profiles, labels, presets, prefs, canRun, notice = null, state, onState, focusSignal, open, onOpenChange }) {
  const editing = tool === 'edit';
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const box = useRef(null);
  const set = (patch) => onState((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (!focusSignal) return undefined;
    // After the menu that asked for it has closed and let go of the focus.
    const timer = setTimeout(() => box.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [focusSignal]);

  const chosen = profiles.filter((profile) => state.models.includes(profile.id));
  // An edit is as long as the video it changes.
  const duration = editing ? Math.max(1, Math.round(source.duration ?? 5)) : state.duration;
  const plans = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, planClip(profile, { target: state.resolution, duration, audio: !editing && state.audio, width: source.width, height: source.height })])),
    [profiles, state.resolution, duration, editing, state.audio, source.width, source.height],
  );
  const chosenPlans = chosen.map((profile) => plans.get(profile.id));
  const known = chosenPlans.every((plan) => typeof plan.cost === 'number');
  const estimate = chosenPlans.reduce((sum, plan) => sum + (plan.cost ?? 0), 0);
  const approximate = chosenPlans.some((plan) => plan.approximate);
  const soundPossible = !editing && chosen.some((profile) => profile.audio);
  const remote = chosen.some((profile) => !profile.local);
  const blocked = pending || !chosen.length || (remote && !canRun) || (editing && !state.instruction.trim());
  const verb = chosen.length > 1 ? 'Compare' : editing ? 'Edit' : 'Animate';
  const compare = chosen.length > 1;

  const submit = (event, { confirmed = false } = {}) => {
    event?.preventDefault();
    if (blocked) return;
    if (!confirmed && remote && prefs.confirmAbove > 0 && (!known || estimate > prefs.confirmAbove)) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const common = { sessionId, models: state.models, instruction: state.instruction, resolution: state.resolution, parentJobId: state.parent?.id ?? null };
      const result = editing
        ? await startVideoEdit(common)
        : await startVideo({ ...common, preset: state.preset, duration: state.duration, audio: Boolean(state.audio && soundPossible) });
      if (result?.error) return toast.error(result.error);
      set({ instruction: '', parent: null });
      router.refresh();
    });
  };

  const price = !chosen.length ? '' : known ? (estimate === 0 ? 'Free' : `${approximate ? '≈ ' : ''}${formatPrice(estimate)}`) : 'Price after first run';
  const shapes = [...new Set(chosenPlans.map((plan) => plan.aspect).filter(Boolean))].join(' / ');
  const label = compare ? `Compare ${chosen.length} models` : editing ? 'Edit Video' : `Animate · ${presets[state.preset]?.label ?? ''}`;
  const motion = presets[state.preset] ?? {};

  if (!open) {
    return (
      <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-3 pb-3 md:px-8">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="mx-auto flex w-full max-w-5xl items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg hover:bg-accent/60"
        >
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{label}</span>
          <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">Show the composer</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-6 pb-4 md:px-8">
      <form onSubmit={submit} className="mx-auto w-full max-w-5xl space-y-2 rounded-2xl border bg-card p-2 shadow-lg">
        {state.parent ? (
          <div className="flex items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
            Changing #{state.parent.number}
            <Button type="button" size="icon" variant="ghost" className="size-6" onClick={() => set({ parent: null })} aria-label="Start fresh instead">
              <X className="size-3.5" />
            </Button>
          </div>
        ) : null}

        {/* The motion, with the chosen one spelled out below: a tooltip would hide it, and
            wrapping each item in one also overrides the toggle's own selected state. */}
        {editing ? null : (
          <>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={state.preset}
              onValueChange={(value) => value && set({ preset: value })}
              className="flex w-full flex-wrap justify-start px-1 pt-1 *:data-[slot=toggle-group-item]:flex-none"
              aria-label="Motion"
            >
              {Object.entries(presets).filter(([, preset]) => !preset.retired).map(([key, preset]) => (
                <ToggleGroupItem key={key} value={key} className="px-3">
                  {preset.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="px-2 text-xs text-muted-foreground">
              {motion.description}
              {chosen.some((profile) => profile.id === LOCAL_MOTION) && motion.localMotion ? ` Ken Burns makes ${motion.localMotion}.` : ''}
            </p>
          </>
        )}

        <Textarea
          ref={box}
          value={state.instruction}
          onChange={(event) => set({ instruction: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event);
          }}
          placeholder={editing ? 'Describe the change, e.g. “make it look like a 1970s home movie”' : 'Optional: about the camera, e.g. “end closer to the faces” or “move more slowly”'}
          maxLength={editing ? 600 : 300}
          rows={1}
          className="max-h-32 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label={editing ? 'The change to make' : 'Extra instructions'}
        />

        <div className="flex flex-wrap items-center gap-2 px-1 pb-0.5">
          <ModelChooser
            profiles={profiles}
            chosen={state.models}
            plans={plans}
            onChange={(models) => set({ models })}
            // With a notice the key is not the problem; the models stay pickable.
            canRun={canRun || Boolean(notice)}
            disabled={pending}
            motion={motion}
            editing={editing}
          />
          <Choice value={state.resolution} onChange={(resolution) => set({ resolution })} options={VIDEO_TARGETS} label="Size" disabled={pending} />
          {editing ? null : (
            <Choice value={state.duration} onChange={(value) => set({ duration: value })} options={DURATIONS} label="Length" format={(v) => `${v} s`} disabled={pending} />
          )}
          {soundPossible ? (
            <Label className="flex items-center gap-2 px-1 text-sm font-normal">
              <Switch checked={state.audio} onCheckedChange={(audio) => set({ audio })} disabled={pending} size="sm" />
              Sound
            </Label>
          ) : null}
          <span className={cn('ml-auto text-xs tabular-nums text-muted-foreground', compare && 'font-medium text-foreground')}>
            {[price, shapes, editing ? `${duration} s` : null, compare ? `${chosen.length} clips` : null].filter(Boolean).join(' · ')}
          </span>
          <Button type="button" size="icon" variant="ghost" className="size-9 text-muted-foreground" onClick={() => onOpenChange(false)} aria-label="Hide the composer">
            <ChevronDown className="size-4" />
          </Button>
          <Button type="submit" disabled={blocked}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            {verb}
          </Button>
        </div>
        {notice ? (
          <p className="flex items-start gap-1.5 px-2 pb-1 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {notice}
          </p>
        ) : remote && !canRun ? (
          <p className="px-2 pb-1 text-xs text-muted-foreground">
            <Link href="/settings" className="font-medium text-foreground underline underline-offset-2">
              Add your OpenRouter key
            </Link>{' '}
            {editing ? 'to edit videos.' : 'to use AI models. Ken Burns works without one.'}
          </p>
        ) : null}
      </form>

      <ResponsiveDialog open={confirming} onOpenChange={setConfirming}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{known ? `Start for about ${formatPrice(estimate)}?` : 'Start without a known price?'}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {known
                ? `${chosen.map((profile) => profile.label).join(', ')} ${chosen.length > 1 ? 'are' : 'is'} estimated at ${formatPrice(estimate)} in total, above the ${formatPrice(prefs.confirmAbove)} you set in Settings.`
                : `OpenRouter bills ${chosen.filter((profile) => typeof plans.get(profile.id).cost !== 'number').map((profile) => labels[profile.id] ?? profile.label).join(', ')} by the amount of video it makes, so the price is known only once it has run.`}{' '}
              It is billed to your OpenRouter account, and cannot be cancelled once started.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </ResponsiveDialogClose>
            <Button onClick={() => submit(null, { confirmed: true })}>{verb}</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
