'use client';

import { useRef, useState, useTransition } from 'react';
import { Eye, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fillTemplate } from '@/lib/prompts/defaults';
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
import { resetAllPrompts, resetPrompt, savePromptText } from './actions';

// What each placeholder becomes, so the preview reads like a real request.
const SAMPLES = {
  stats:
    'Size 1920×2524 (portrait, 4.8 MP).\nExposure: median luminance 68/255 (dark); 0% crushed shadows, 0% blown highlights.\nColor balance vs green: red +31%, blue -41% (warm/yellow-orange cast).',
  analysis: 'Color problems found in this photo:\n- Heavy yellow cast (whole image, strong)\nCorrections to make:\n- Neutralize the yellow cast so whites look white',
  instruction: 'Additional request from the user: faces look too red',
};
const FOLLOWUP_SAMPLE = { instruction: 'a little darker' };
const MOTION_SAMPLE = { instruction: 'Also: end closer to the faces' };
const EDIT_SAMPLE = { instruction: 'make it look like a 1970s home movie' };
const REPAIR_SAMPLE = { instruction: 'the scratch across the sky' };
const EDIT_IMAGE_SAMPLE = { instruction: 'give him a red baseball cap' };
const sampleFor = (key) =>
  key === 'followup' ? FOLLOWUP_SAMPLE : key === 'repair-refine' ? REPAIR_SAMPLE : key === 'video-edit' ? EDIT_SAMPLE : key === 'edit' || key === 'edit-area' ? EDIT_IMAGE_SAMPLE : key.startsWith('motion-') ? MOTION_SAMPLE : SAMPLES;

function PromptEditor({ prompt }) {
  const [text, setText] = useState(prompt.text);
  const [saved, setSaved] = useState(prompt.text);
  const [custom, setCustom] = useState(prompt.custom);
  const [preview, setPreview] = useState(false);
  const [pending, startTransition] = useTransition();
  const box = useRef(null);
  const dirty = text !== saved;

  const insert = (name) => {
    const element = box.current;
    const token = `{{${name}}}`;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = () =>
    startTransition(async () => {
      const result = await savePromptText(prompt.key, text);
      if (result?.error) return toast.error(result.error);
      setSaved(text);
      setCustom(result.custom);
      toast.success(`${prompt.label} prompt saved`);
    });

  const reset = () =>
    startTransition(async () => {
      const result = await resetPrompt(prompt.key);
      if (result?.error) return toast.error(result.error);
      setText(result.text);
      setSaved(result.text);
      setCustom(false);
      toast(`${prompt.label} prompt reset to the default`);
    });

  return (
    <section className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{prompt.label}</h3>
        {custom ? <Badge variant="secondary">Customized</Badge> : <Badge variant="outline">Default</Badge>}
        {dirty ? <span className="text-xs text-warning">Unsaved changes</span> : null}
      </div>
      <p className="text-sm text-muted-foreground">{prompt.description}</p>
      <Textarea
        ref={box}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        spellCheck={false}
        className="font-mono text-xs leading-relaxed"
        aria-label={`${prompt.label} prompt`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Insert:</span>
        {prompt.placeholders.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => insert(name)}
            className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
          >
            {`{{${name}}}`}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreview((value) => !value)}>
            <Eye className="size-4" />
            {preview ? 'Hide preview' : 'Preview'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending || (!custom && !dirty)}>
            <RotateCcw className="size-4" />
            Reset
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={!dirty || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
      {preview ? (
        <pre className="max-h-72 overflow-auto rounded-lg border bg-stage/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {fillTemplate(text, sampleFor(prompt.key))}
        </pre>
      ) : null}
    </section>
  );
}

/** Puts every prompt back to its default, after asking: unsaved edits go too. */
function ResetAll({ onReset }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const reset = () =>
    startTransition(async () => {
      const result = await resetAllPrompts();
      if (result?.error) return toast.error(result.error);
      onReset();
      setOpen(false);
      toast('Every prompt is back to its default');
    });
  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <RotateCcw className="size-4" />
          Reset all prompts
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Reset all prompts?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Every prompt goes back to Aurai&apos;s default. Your own versions, and any unsaved changes, are lost.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </ResponsiveDialogClose>
          <Button type="button" variant="destructive" onClick={reset} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Reset all
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function PromptsForm({ prompts }) {
  const [list, setList] = useState(prompts);
  // Each reset-all starts the editors afresh, from the defaults.
  const [round, setRound] = useState(0);
  const resetAll = () => {
    setList((current) => current.map((prompt) => ({ ...prompt, text: prompt.defaultText, custom: false })));
    setRound((n) => n + 1);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ResetAll onReset={resetAll} />
      </div>
      <div className="divide-y">
        {list.map((prompt) => (
          <PromptEditor key={`${prompt.key}-${round}`} prompt={prompt} />
        ))}
      </div>
    </div>
  );
}
