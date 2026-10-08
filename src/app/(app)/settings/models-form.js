'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDuration, priceLabel, priceSource } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SHORT_SIDE } from '@/lib/video-pricing';
import { addModel, refreshModelCatalog } from './actions';
import { usePrefs } from './use-save';

const DEFAULT_QUALITY = 'default';

const ago = (time) => {
  if (!time) return 'never';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

function Section({ title, description, children }) {
  return (
    <section className="space-y-3">
      <div className="text-sm">
        <h3 className="font-medium">{title}</h3>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Caveat({ text }) {
  if (!text) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-warning">
      <TriangleAlert className="size-3 shrink-0" />
      {text}
    </span>
  );
}

function Price({ model }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block cursor-help font-medium text-foreground">
          {priceLabel(model)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{priceSource(model)}</TooltipContent>
    </Tooltip>
  );
}

function ImageRow({ model, checked, onChange, disabled, quality, onQuality }) {
  const id = `model-${model.id}`;
  const details = [
    model.provider,
    model.maxResolution ? `up to ${model.maxResolution}` : null,
    model.seconds ? `${formatDuration(model.seconds)} a run` : null,
  ].filter(Boolean);
  return (
    <div className={cn('flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/60', checked && 'bg-accent/40')}>
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(Boolean(on))} disabled={disabled} className="mt-0.5" />
      <div className="grid min-w-0 flex-1 gap-1">
        <Label htmlFor={id} className="grid min-w-0 cursor-pointer gap-0.5 font-normal">
          <span className="flex min-w-0 items-baseline gap-2 text-sm">
            {model.rank !== null && !checked ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{model.rank + 1}</span> : null}
            <span className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{model.label}</span>
          </span>
          <span className="text-xs text-muted-foreground">{details.join(' · ')}</span>
          <Caveat text={model.caveat} />
        </Label>
        {checked && model.qualities.length ? (
          <Select value={quality ?? DEFAULT_QUALITY} onValueChange={onQuality} disabled={disabled}>
            <SelectTrigger size="sm" className="h-7 w-fit gap-1 px-2 text-xs" aria-label={`Quality for ${model.label}`}>
              <span className="text-muted-foreground">Quality:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_QUALITY}>Model default</SelectItem>
              {model.qualities
                .filter((value) => value !== 'auto')
                .map((value) => (
                  <SelectItem key={value} value={value} className="capitalize">
                    {value}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        <Price model={model} />
        {model.resolution ? `at ${model.resolution}` : 'its own size'}
      </span>
    </div>
  );
}

function VisionRow({ model, rank = true }) {
  const id = `analysis-${model.id}`;
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 font-normal hover:bg-accent/60 has-[[data-state=checked]]:bg-accent/40">
      <RadioGroupItem id={id} value={model.id} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2 text-sm">
          {rank && model.rank !== null ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{model.rank + 1}</span> : null}
          <span className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{model.label}</span>
        </span>
        <span className="text-xs text-muted-foreground">{model.provider}</span>
        <Caveat text={model.caveat} />
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {typeof model.cost === 'number' ? `≈ $${model.cost.toFixed(4)}` : '?'} / photo
      </span>
    </Label>
  );
}

function VideoRow({ model, checked, onChange, disabled, editing = false }) {
  const id = `${editing ? 'edit' : 'video'}-${model.id}`;
  const lengths = model.durations.length ? `${Math.min(...model.durations)}–${Math.max(...model.durations)} s` : null;
  const largest = [...model.resolutions].sort((a, b) => (SHORT_SIDE[a] ?? 0) - (SHORT_SIDE[b] ?? 0)).at(-1);
  const sizes = largest ? `up to ${largest}` : null;
  // For Edit Video, whether it changes the video given, or makes a new one that follows it.
  const role = editing ? (model.frames ? 'makes a new video guided by yours' : 'edits your video') : null;
  const details = [model.provider, role, sizes, lengths, !editing && model.audio ? 'can add sound' : null, model.seconds ? `${formatDuration(model.seconds)} a clip` : null].filter(Boolean);
  return (
    <div className={cn('flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/60', checked && 'bg-accent/40')}>
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(Boolean(on))} disabled={disabled} className="mt-0.5" />
      <Label htmlFor={id} className="grid min-w-0 flex-1 cursor-pointer gap-0.5 font-normal">
        <span className="flex min-w-0 items-baseline gap-2 text-sm">
          {model.rank !== null && !checked ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{model.rank + 1}</span> : null}
          <span className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{model.label}</span>
        </span>
        <span className="text-xs text-muted-foreground">{details.join(' · ')}</span>
        <Caveat text={model.caveat} />
      </Label>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        <Price model={model.sample} />
        {model.sample.duration} s{model.sample.resolution ? ` at ${model.sample.resolution}` : ''}
      </span>
    </div>
  );
}

/** A box for any model on OpenRouter, by id or link, with suggestions from the catalog. */
function AddModel({ kind, suggestions, onAdded }) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const query = value.trim().toLowerCase();
  const matches =
    query.length >= 2
      ? suggestions.filter((model) => model.id.toLowerCase().includes(query) || model.label.toLowerCase().includes(query)).slice(0, 6)
      : [];

  const add = (id) =>
    startTransition(async () => {
      const result = await addModel(kind, id);
      if (result?.error) return toast.error(result.error);
      setValue('');
      toast.success(kind === 'vision' ? 'Analysis model changed' : 'Model added');
      onAdded(result.prefs);
    });

  return (
    <form
      className="space-y-2 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (query) add(value);
      }}
    >
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        {
          {
            vision: 'Use any vision model from OpenRouter',
            video: 'Add any video model from OpenRouter',
            'video-edit': 'Add any OpenRouter video model that takes a video in',
          }[kind] ?? 'Add any model from OpenRouter'
        }
      </Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="vendor/model-name, or its openrouter.ai link"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          className="h-9 font-mono text-sm"
        />
        <Button type="submit" variant="outline" disabled={!query || pending} className="h-9 shrink-0">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {kind === 'vision' ? 'Use' : 'Add'}
        </Button>
      </div>
      {matches.length ? (
        <ul className="overflow-hidden rounded-lg border" aria-label="Matching models">
          {matches.map((model) => (
            <li key={model.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => add(model.id)}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-accent/60"
              >
                <span className="min-w-0 font-medium leading-snug [overflow-wrap:anywhere]">{model.label}</span>
                <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{model.id}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

function ModelTabs({ selectedCount, popularCount, selected, popular, footer, popularLabel = 'Most used' }) {
  return (
    <Tabs defaultValue="selected" className="gap-3">
      <TabsList variant="line">
        <TabsTrigger value="selected">Selected ({selectedCount})</TabsTrigger>
        <TabsTrigger value="popular">
          {popularLabel} ({popularCount})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="selected">{selected}</TabsContent>
      <TabsContent value="popular">{popular}</TabsContent>
      {footer}
    </Tabs>
  );
}

export function ModelsForm({ prefs: initial, images, vision, videos, edits, editNotice = null, updatedAt }) {
  const router = useRouter();
  const [prefs, update, pending, replace] = usePrefs(initial, { onSaved: () => router.refresh() });
  const [refreshing, startRefresh] = useTransition();

  // Rows come from the server; which list each sits in follows the person's choices right away.
  const byId = new Map([...images.popular, ...images.selected].map((model) => [model.id, model]));
  const enabled = new Set(prefs.enabledModels);
  const selected = prefs.enabledModels.map((id) => byId.get(id)).filter(Boolean);
  const popular = images.popular.filter((model) => !enabled.has(model.id));
  const videoById = new Map([...videos.popular, ...videos.selected].map((model) => [model.id, model]));
  const videoEnabled = new Set(prefs.videoModels);
  const videoSelected = prefs.videoModels.map((id) => videoById.get(id)).filter(Boolean);
  const videoPopular = videos.popular.filter((model) => !videoEnabled.has(model.id));
  const editById = new Map([...edits.popular, ...edits.selected].map((model) => [model.id, model]));
  const editEnabled = new Set(prefs.editModels);
  const editSelected = prefs.editModels.map((id) => editById.get(id)).filter(Boolean);
  const editPopular = edits.popular.filter((model) => !editEnabled.has(model.id));
  const visionById = new Map([vision.selected, ...vision.popular].filter(Boolean).map((model) => [model.id, model]));
  const analysis = visionById.get(prefs.analysisModel) ?? vision.selected;

  const added = (next) => {
    replace(next);
    router.refresh();
  };

  // `field` is the list being changed: image, video or Edit Video models.
  const toggle = (model, on, field = 'enabledModels') => {
    const previous = prefs[field];
    if (on) return update({ [field]: [...previous, model.id] });
    if (previous.length === 1) return toast.error('Keep at least one model.');
    update({ [field]: previous.filter((id) => id !== model.id) });
    toast(`Removed ${model.label}`, { action: { label: 'Undo', onClick: () => update({ [field]: previous }) } });
  };

  const setQuality = (model, value) => {
    const qualities = { ...prefs.qualities };
    if (value === DEFAULT_QUALITY) delete qualities[model.id];
    else qualities[model.id] = value;
    update({ qualities });
  };

  return (
    <div className="space-y-8">
      <Section
        title="Maximum output size"
        description="The AI redraw matches your photo's size up to this. The Local version is always your photo's full resolution. Prices below are at this size."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          value={prefs.maxResolution}
          onValueChange={(value) => value && update({ maxResolution: value })}
          disabled={pending}
          aria-label="Maximum output size"
        >
          {['1K', '2K', '4K'].map((value) => (
            <ToggleGroupItem key={value} value={value} className="px-5">
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section title="Default models" description="What each tool starts with, from your selected models.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['enhanceModel', 'Enhance', selected],
            ['colorizeModel', 'Colorize', selected],
            ['repairModel', 'Repair', selected],
            // Upscale needs a model that draws at 2K or more.
            ['upscaleModel', 'Upscale', selected.filter((model) => ['2K', '4K'].includes(model.maxResolution))],
          ].map(([field, label, models]) => (
            <div key={field} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <Select
                value={models.some((model) => model.id === prefs[field]) ? prefs[field] : (models[0]?.id ?? undefined)}
                onValueChange={(value) => update({ [field]: value })}
                disabled={pending || !models.length}
              >
                <SelectTrigger className="w-full" aria-label={`Default for ${label}`}>
                  <SelectValue placeholder={field === 'upscaleModel' ? 'None of your models draws at 2K' : 'No models selected'} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Image models"
        description="Selected models appear in the model picker under each photo. Prices are worked out from OpenRouter's pricing, and from your runs once a model has run."
      >
        <ModelTabs
          selectedCount={selected.length}
          popularCount={popular.length}
          selected={
            <div className="space-y-1">
              {selected.map((model) => (
                <ImageRow
                  key={model.id}
                  model={model}
                  checked
                  onChange={(on) => toggle(model, on)}
                  disabled={pending}
                  quality={prefs.qualities[model.id]}
                  onQuality={(value) => setQuality(model, value)}
                />
              ))}
            </div>
          }
          popular={
            <div className="space-y-1">
              <p className="px-3 pb-1 text-xs text-muted-foreground">The image editors used most on OpenRouter this week.</p>
              {popular.length ? (
                popular.map((model) => <ImageRow key={model.id} model={model} checked={false} onChange={(on) => toggle(model, on)} disabled={pending} />)
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">You have selected all of them.</p>
              )}
            </div>
          }
          footer={<AddModel kind="image" suggestions={images.all.filter((model) => !enabled.has(model.id))} onAdded={added} />}
        />
      </Section>

      <Section
        title="Video models"
        description="Selected models appear when you animate a photo; pick several there to compare them. Prices are for one clip with your defaults. Ken Burns, made here for free, is always there too."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Starts with (until you have made a clip)</Label>
            <Select value={prefs.videoModel ?? undefined} onValueChange={(value) => update({ videoModel: value })} disabled={pending || !videoSelected.length}>
              <SelectTrigger className="w-full" aria-label="Default video model">
                <SelectValue placeholder="No models selected" />
              </SelectTrigger>
              <SelectContent>
                {videoSelected.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <ModelTabs
          selectedCount={videoSelected.length}
          popularCount={videoPopular.length}
          popularLabel={videos.rankBy === 'newest' ? 'Newest' : 'Most used'}
          selected={
            <div className="space-y-1">
              {videoSelected.map((model) => (
                <VideoRow key={model.id} model={model} checked onChange={(on) => toggle(model, on, 'videoModels')} disabled={pending} />
              ))}
            </div>
          }
          popular={
            <div className="space-y-1">
              <p className="px-3 pb-1 text-xs text-muted-foreground">
                Video models that can start from a photo, {videos.rankBy === 'newest' ? 'newest first (OpenRouter publishes no usage ranking for video)' : 'by use on OpenRouter this week'}.
              </p>
              {videoPopular.length ? (
                videoPopular.map((model) => <VideoRow key={model.id} model={model} checked={false} onChange={(on) => toggle(model, on, 'videoModels')} disabled={pending} />)
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">You have selected all of them.</p>
              )}
            </div>
          }
          footer={<AddModel kind="video" suggestions={videos.all.filter((model) => !videoEnabled.has(model.id))} onAdded={added} />}
        />
      </Section>

      <Section
        title="Edit Video models"
        description="Selected models appear when you edit a video; pick several there to compare them. Prices are for editing a 5-second video at your default size."
      >
        {editNotice ? (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {editNotice}
          </p>
        ) : null}
        <ModelTabs
          selectedCount={editSelected.length}
          popularCount={editPopular.length}
          popularLabel={edits.rankBy === 'newest' ? 'Newest' : 'Most used'}
          selected={
            <div className="space-y-1">
              {editSelected.map((model) => (
                <VideoRow key={model.id} model={model} editing checked onChange={(on) => toggle(model, on, 'editModels')} disabled={pending} />
              ))}
            </div>
          }
          popular={
            <div className="space-y-1">
              <p className="px-3 pb-1 text-xs text-muted-foreground">
                Video models that take a video in: those made to edit one first, then those that make a new video guided by yours;{' '}
                {edits.rankBy === 'newest' ? 'newest first within each' : 'by use on OpenRouter this week within each'}.
              </p>
              {editPopular.length ? (
                editPopular.map((model) => <VideoRow key={model.id} model={model} editing checked={false} onChange={(on) => toggle(model, on, 'editModels')} disabled={pending} />)
              ) : (
                <p className="px-3 py-2 text-sm text-muted-foreground">You have selected all of them.</p>
              )}
            </div>
          }
          footer={<AddModel kind="video-edit" suggestions={edits.all.filter((model) => !editEnabled.has(model.id))} onAdded={added} />}
        />
      </Section>

      <Section title="Analysis model" description="Looks at each photo before Enhance or Colorize and names what to fix. Turn it off in Defaults.">
        <ModelTabs
          selectedCount={analysis ? 1 : 0}
          popularCount={vision.popular.length}
          selected={
            analysis ? (
              <RadioGroup value={prefs.analysisModel} className="gap-1" disabled={pending}>
                <VisionRow model={analysis} rank={false} />
              </RadioGroup>
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">No analysis model yet. Pick one under Most used.</p>
            )
          }
          popular={
            <RadioGroup value={prefs.analysisModel ?? ''} onValueChange={(value) => update({ analysisModel: value })} className="gap-1" disabled={pending}>
              <p className="px-3 pb-1 text-xs text-muted-foreground">Vision models with structured output, by use on OpenRouter this week.</p>
              {vision.popular.map((model) => (
                <VisionRow key={model.id} model={model} />
              ))}
            </RadioGroup>
          }
          footer={<AddModel kind="vision" suggestions={vision.all.filter((model) => model.id !== prefs.analysisModel)} onAdded={added} />}
        />
      </Section>

      <div className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
        Model list and prices from OpenRouter, updated {ago(updatedAt)}.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7"
          disabled={refreshing}
          onClick={() =>
            startRefresh(async () => {
              const result = await refreshModelCatalog();
              if (result?.error) toast.error(result.error);
              else router.refresh();
            })
          }
        >
          {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </div>
    </div>
  );
}
