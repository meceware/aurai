'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

const QUALITIES = [
  { value: 'max', label: 'Maximum', note: '95% · largest file' },
  { value: 'high', label: 'High', note: '90%' },
  { value: 'medium', label: 'Medium', note: '80%' },
  { value: 'small', label: 'Small', note: '70% · for sharing' },
];

function Choice({ id, value, title, note, selected }) {
  return (
    <Label
      htmlFor={id}
      className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 font-normal hover:bg-accent/60', selected && 'border-brand/50 bg-accent/50')}
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="grid gap-0.5 text-sm">
        <span className="font-medium">{title}</span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </span>
    </Label>
  );
}

/**
 * Asks what to download: which version, which format, and for JPEG how much compression. The
 * Local version comes with the current Color / Brightness / Exposure settings applied.
 */
export function DownloadDialog({ open, onOpenChange, initialVersion = 'locked', versions, single = false, run, number, source, title, dials, adjusted, defaults }) {
  const [version, setVersion] = useState(initialVersion);
  const [format, setFormat] = useState(defaults?.downloadFormat ?? 'jpeg');
  const [quality, setQuality] = useState(defaults?.jpegQuality ?? 'max');

  const asset = version === 'locked' ? run.locked : version === 'ai' ? run.ai : source;
  const name = `${title}-${number}-${version === 'locked' ? 'local' : version === 'ai' ? 'ai' : 'original'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);

  const href = (() => {
    const params = new URLSearchParams({ name });
    if (version === 'original') return `/api/media/${source.id}/download?${params}`;
    params.set('format', format);
    if (format === 'jpeg') params.set('quality', quality);
    if (version === 'locked' && adjusted) {
      params.set('color', String(dials.color / 100));
      params.set('light', String(dials.light / 100));
      params.set('ev', String(dials.ev));
    }
    return `/api/media/${asset.id}/download?${params}`;
  })();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Download result #{number}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Keeps the photo&apos;s original date and camera details; never its location.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          <RadioGroup value={version} onValueChange={setVersion} className="gap-2">
            <Choice
              id="dl-locked"
              value="locked"
              selected={version === 'locked'}
              title={versions?.locked.name ?? 'Local'}
              note={
                single && run.ai
                  ? `As the model drew it · ${run.locked.width}×${run.locked.height}`
                  : `${run.locked.width > source.width ? 'Your photo, enlarged' : 'Your photo at full resolution'} · ${run.locked.width}×${run.locked.height}${adjusted ? ' · with your adjustments' : ''}`
              }
            />
            {/* Upscale's free resize has no AI redraw, and an unpainted edit is the AI's image itself. */}
            {run.ai && !single ? (
              <Choice id="dl-ai" value="ai" selected={version === 'ai'} title={versions?.ai.name ?? 'AI redraw'} note={`As the model drew it · ${run.ai.width}×${run.ai.height}`} />
            ) : null}
            <Choice id="dl-original" value="original" selected={version === 'original'} title="Original" note="Exactly as you uploaded it" />
          </RadioGroup>

          {version === 'original' ? null : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Format</span>
                <ToggleGroup type="single" variant="outline" size="sm" value={format} onValueChange={(value) => value && setFormat(value)} aria-label="Format">
                  <ToggleGroupItem value="jpeg" className="px-4">
                    JPEG
                  </ToggleGroupItem>
                  <ToggleGroupItem value="png" className="px-4">
                    PNG
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {format === 'jpeg' ? (
                <RadioGroup value={quality} onValueChange={setQuality} className="grid grid-cols-2 gap-2">
                  {QUALITIES.map((option) => (
                    <Choice key={option.value} id={`q-${option.value}`} value={option.value} selected={quality === option.value} title={option.label} note={option.note} />
                  ))}
                </RadioGroup>
              ) : (
                <p className="text-xs text-muted-foreground">PNG is lossless, and a much larger file. It cannot add detail beyond what the result has.</p>
              )}
            </div>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button asChild onClick={() => setTimeout(() => onOpenChange(false), 300)}>
            <a href={href}>
              <Download className="size-4" />
              Download
            </a>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
