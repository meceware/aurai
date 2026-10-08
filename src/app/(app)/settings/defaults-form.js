'use client';

import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { DURATIONS, VIDEO_TARGETS } from '@/lib/video-pricing';
import { usePrefs } from './use-save';

const LOCKS = [
  { value: 'local', title: 'Adapt to each area', description: 'Also fixes fading that differs across the photo, like sun-faded edges. Recommended.' },
  { value: 'global', title: 'One correction for the whole photo', description: 'The same color change everywhere. Simpler, and enough for evenly faded prints.' },
];

const THRESHOLDS = [
  { value: '0', label: 'Never ask' },
  { value: '0.1', label: 'Over $0.10' },
  { value: '0.25', label: 'Over $0.25' },
  { value: '0.5', label: 'Over $0.50' },
  { value: '1', label: 'Over $1.00' },
  { value: '2', label: 'Over $2.00' },
  { value: '5', label: 'Over $5.00' },
];

function Setting({ title, description, children, htmlFor }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex-1 text-sm">
        <Label htmlFor={htmlFor} className="font-medium">
          {title}
        </Label>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function DefaultsForm({ prefs: initial, presets }) {
  const [prefs, update, pending] = usePrefs(initial);

  return (
    <div className="divide-y">
      <Setting
        htmlFor="analysis"
        title="Analyze the photo first"
        description="A quick look by your analysis model (usually a fraction of a cent) that tells the image model exactly what to fix. Made results noticeably more accurate in testing."
      >
        <Switch id="analysis" checked={prefs.analysis} onCheckedChange={(value) => update({ analysis: value })} disabled={pending} />
      </Setting>

      <div className="space-y-3 py-4">
        <div className="text-sm">
          <p className="font-medium">How the Local version is made</p>
          <p className="text-muted-foreground">Local keeps your photo&apos;s own pixels and applies the AI&apos;s color correction to them.</p>
        </div>
        <RadioGroup value={prefs.lock} onValueChange={(value) => update({ lock: value })} className="gap-1" disabled={pending}>
          {LOCKS.map((lock) => (
            <Label
              key={lock.value}
              htmlFor={`lock-${lock.value}`}
              className={cn('flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 font-normal hover:bg-accent/60', prefs.lock === lock.value && 'bg-accent')}
            >
              <RadioGroupItem id={`lock-${lock.value}`} value={lock.value} className="mt-0.5" />
              <span className="grid gap-0.5 text-sm">
                <span className="font-medium">{lock.title}</span>
                <span className="text-muted-foreground">{lock.description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      <Setting title="Download format" description="What the Download button suggests first. You can still choose each time.">
        <div className="flex gap-2">
          <Select value={prefs.downloadFormat} onValueChange={(value) => update({ downloadFormat: value })} disabled={pending}>
            <SelectTrigger className="w-28" aria-label="Download format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jpeg">JPEG</SelectItem>
              <SelectItem value="png">PNG</SelectItem>
            </SelectContent>
          </Select>
          <Select value={prefs.jpegQuality} onValueChange={(value) => update({ jpegQuality: value })} disabled={pending || prefs.downloadFormat !== 'jpeg'}>
            <SelectTrigger className="w-40" aria-label="JPEG quality">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="max">Maximum (95%)</SelectItem>
              <SelectItem value="high">High (90%)</SelectItem>
              <SelectItem value="medium">Medium (80%)</SelectItem>
              <SelectItem value="small">Small (70%)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Setting>

      <div className="pt-6 pb-1 text-sm">
        <p className="font-medium">Animate from Image</p>
        <p className="text-muted-foreground">What a new clip starts with. Each model uses the nearest size and length it supports.</p>
      </div>

      <Setting title="Motion" description="The camera move a new clip starts with.">
        <Select value={prefs.videoPreset} onValueChange={(value) => update({ videoPreset: value })} disabled={pending}>
          <SelectTrigger className="w-40" aria-label="Motion">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(presets).map(([key, preset]) => (
              <SelectItem key={key} value={key}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Setting>

      <Setting title="Size and length" description="Bigger and longer clips cost more; most models charge per second.">
        <div className="flex gap-2">
          <Select value={prefs.videoResolution} onValueChange={(value) => update({ videoResolution: value })} disabled={pending}>
            <SelectTrigger className="w-28" aria-label="Video size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_TARGETS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(prefs.videoDuration)} onValueChange={(value) => update({ videoDuration: Number(value) })} disabled={pending}>
            <SelectTrigger className="w-24" aria-label="Video length">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value} s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Setting>

      <Setting htmlFor="video-audio" title="Sound" description="For models that can add sound. Usually costs more, and old photos rarely need it.">
        <Switch id="video-audio" checked={prefs.videoAudio} onCheckedChange={(value) => update({ videoAudio: value })} disabled={pending} />
      </Setting>

      <Setting
        htmlFor="video-anchor"
        title="Anchor the ending (experimental)"
        description="For models that take a last frame: also give the model the view the move ends on, cut from your photo, so the clip has to end on your real photo. Can reduce drift in faces; some models move less."
      >
        <Switch id="video-anchor" checked={prefs.videoAnchor} onCheckedChange={(value) => update({ videoAnchor: value })} disabled={pending} />
      </Setting>

      <Setting title="Confirm before spending" description="Ask before starting a run whose estimated cost is above this.">
        <Select value={String(prefs.confirmAbove)} onValueChange={(value) => update({ confirmAbove: Number(value) })} disabled={pending}>
          <SelectTrigger className="w-52" aria-label="Confirm before spending">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THRESHOLDS.map((threshold) => (
              <SelectItem key={threshold.value} value={threshold.value}>
                {threshold.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Setting>
    </div>
  );
}
