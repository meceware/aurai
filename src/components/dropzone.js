'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Film, ImageUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { isImageMode, MAX_BATCH_PHOTOS } from '@/lib/image-tools';
import { cn } from '@/lib/utils';

// What each kind of upload takes. Listing only these image types makes iOS convert HEIC photos
// to JPEG when picking from the library.
const KINDS = {
  photo: {
    accept: 'image/jpeg,image/png,image/webp,image/tiff',
    maxBytes: 30 * 1024 * 1024,
    is: (file) => file.type.startsWith('image/'),
    icon: ImageUp,
    noun: 'photo',
    formats: 'JPEG, PNG, WebP or TIFF up to 30 MB',
  },
  video: {
    accept: 'video/mp4,video/quicktime,video/webm,video/x-m4v',
    maxBytes: 90 * 1024 * 1024,
    is: (file) => file.type.startsWith('video/'),
    icon: Film,
    noun: 'video',
    formats: 'MP4, MOV or WebM up to 90 MB and 30 seconds',
  },
};

/** XHR rather than fetch: fetch cannot report upload progress. */
function upload(file, mode, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?mode=${encodeURIComponent(mode)}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300 && body.id) resolve(body.id);
      else reject(new Error(body.error || 'The upload failed. Try again.'));
    };
    xhr.onerror = () => reject(new Error('The connection dropped during the upload. Try again.'));
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    xhr.send(form);
  });
}

/**
 * The drop target of a tool's first screen. The image tools take up to MAX_BATCH_PHOTOS photos
 * at once: one opens its page as always, several open the screen that starts them together.
 */
export function Dropzone({ mode = 'enhance', disabled = false }) {
  const kind = mode === 'edit-video' ? KINDS.video : KINDS.photo;
  const several = isImageMode(mode);
  const router = useRouter();
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  // { done, count, fraction }: photos uploaded, how many in all, and how far the current one is.
  const [progress, setProgress] = useState(null);

  const send = useCallback(
    async (list) => {
      const files = [...(list ?? [])].filter(Boolean);
      if (!files.length || disabled || progress !== null) return;
      if (files.length > 1 && !several) return toast.error(`One ${kind.noun} at a time here.`);
      if (files.length > MAX_BATCH_PHOTOS) return toast.error(`Up to ${MAX_BATCH_PHOTOS} photos at a time.`);
      const wrong = files.find((file) => !kind.is(file) && file.type !== '');
      if (wrong) return toast.error(files.length > 1 ? `${wrong.name} is not a ${kind.noun}.` : `That file is not a ${kind.noun}.`);
      const large = files.find((file) => file.size > kind.maxBytes);
      if (large) return toast.error(`${files.length > 1 ? `${large.name}: ` : ''}${kind.noun === 'video' ? 'Videos' : 'Photos'} can be up to ${kind.maxBytes / 1024 / 1024} MB.`);

      // One after another: the server prepares each, and a failure costs only that one.
      const ids = [];
      const failures = [];
      for (const [index, file] of files.entries()) {
        setProgress({ done: index, count: files.length, fraction: 0 });
        try {
          ids.push(await upload(file, mode, (fraction) => setProgress({ done: index, count: files.length, fraction })));
        } catch (error) {
          failures.push(files.length > 1 ? `${file.name}: ${error.message}` : error.message);
        }
      }
      if (failures.length) toast.error(files.length > 1 ? `${failures.length} of ${files.length} could not be uploaded` : failures[0], files.length > 1 ? { description: failures.join('\n') } : undefined);
      if (!ids.length) return setProgress(null);
      setProgress({ done: files.length, count: files.length, fraction: 1 });
      router.push(ids.length === 1 ? `/${mode}/${ids[0]}` : `/${mode}/batch?ids=${ids.join(',')}`);
      router.refresh();
    },
    [mode, kind, several, disabled, progress, router],
  );

  // Pasting a copied image anywhere on the page uploads it.
  useEffect(() => {
    const onPaste = (event) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => kind.is(f));
      if (file) {
        event.preventDefault();
        send([file]);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [send, kind]);

  const busy = progress !== null;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={several ? "Upload photos" : `Upload a ${kind.noun}`}
      onClick={() => !disabled && !busy && input.current?.click()}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !disabled && !busy) {
          event.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        send(event.dataTransfer.files);
      }}
      className={cn(
        'group relative grid min-h-72 cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed bg-stage/40 p-8 text-center outline-none transition-colors',
        'hover:border-brand/50 hover:bg-stage/70 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-ring/30',
        dragging && 'border-brand bg-brand/5',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    >
      <input
        ref={input}
        type="file"
        accept={kind.accept}
        multiple={several}
        className="hidden"
        onChange={(event) => {
          send(event.target.files);
          event.target.value = '';
        }}
      />

      {busy ? (
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-brand" />
          <p className="text-sm font-medium">
            {progress.done >= progress.count
              ? progress.count > 1
                ? 'Opening your photos…'
                : `Preparing your ${kind.noun}…`
              : progress.count > 1
                ? `Uploading ${progress.done + 1} of ${progress.count}… ${Math.round(progress.fraction * 100)}%`
                : progress.fraction < 1
                  ? `Uploading… ${Math.round(progress.fraction * 100)}%`
                  : `Preparing your ${kind.noun}…`}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200"
              style={{ width: `${Math.round(((progress.done + progress.fraction) / progress.count) * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl border bg-card shadow-sm transition-transform group-hover:-translate-y-0.5">
            <kind.icon className="size-6 text-brand" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">{several ? 'Drop photos here' : `Drop a ${kind.noun} here`}</p>
            <p className="text-sm text-muted-foreground">
              {several ? `One, or up to ${MAX_BATCH_PHOTOS} at once` : 'or paste it, or choose a file'} · {kind.formats}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" tabIndex={-1}>
            {several ? 'Choose photos' : `Choose ${kind.noun}`}
          </Button>
        </div>
      )}
    </div>
  );
}
