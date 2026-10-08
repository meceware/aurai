'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { removeAllPhotos } from './actions';

const size = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`);

export function StoragePanel({ usage }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const share = Math.min(100, (usage.bytes / usage.quotaBytes) * 100);
  const photos = Object.values(usage.photos).reduce((sum, n) => sum + n, 0);

  const removeAll = () =>
    startTransition(async () => {
      const result = await removeAllPhotos(confirmation);
      if (result?.error) return toast.error(result.error);
      setOpen(false);
      setConfirmation('');
      toast.success(`Deleted ${result.count} photo${result.count === 1 ? '' : 's'} and everything made from them`);
      router.refresh();
    });

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="font-medium tabular-nums">
            {size(usage.bytes)} <span className="font-normal text-muted-foreground">of {size(usage.quotaBytes)}</span>
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{share.toFixed(share < 1 ? 1 : 0)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className={share > 90 ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-brand'} style={{ width: `${Math.max(share, 1)}%` }} />
        </div>
        <p className="text-muted-foreground">
          {[
            ['enhance', 'Enhance'],
            ['colorize', 'Colorize'],
            ['repair', 'Repair'],
            ['upscale', 'Upscale'],
            ['animate', 'Animate'],
            ['edit-video', 'Edit Video'],
          ]
            .map(([key, name]) => `${usage.photos[key] ?? 0} in ${name}`)
            .join(' · ')}{' '}
          · {usage.results} results · {usage.clips} clips
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="font-medium">Delete all photos</p>
          <p className="text-muted-foreground">Removes every photo, result and video, and every file, from the server. This cannot be undone.</p>
        </div>
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogTrigger asChild>
            <Button variant="outline" className="text-destructive hover:text-destructive" disabled={!photos}>
              <Trash2 className="size-4" />
              Delete all
            </Button>
          </ResponsiveDialogTrigger>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Delete all {photos} photos?</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Every photo, and every result and video made from them, is permanently removed. Type <strong>delete</strong> to confirm.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="delete" aria-label="Type delete to confirm" autoFocus />
            <ResponsiveDialogFooter>
              <ResponsiveDialogClose asChild>
                <Button variant="outline" disabled={pending}>Cancel</Button>
              </ResponsiveDialogClose>
              <Button
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={pending || confirmation.trim().toLowerCase() !== 'delete'}
                onClick={(event) => {
                  event.preventDefault();
                  removeAll();
                }}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Delete everything
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
    </div>
  );
}
