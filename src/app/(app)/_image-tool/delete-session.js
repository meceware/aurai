'use client';

import { useTransition } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
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
import { removeSession } from './actions';

/**
 * `action` is the server action that deletes the session (the image tools' one unless given);
 * `source` is what the session was made from, and `what` what is made from it.
 */
export function DeleteSession({ sessionId, action = removeSession, source = 'photo', what = 'result' }) {
  const [pending, startTransition] = useTransition();
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" />
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete this {source}?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            The original and every {what} made from it are permanently removed from the server.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button variant="outline" disabled={pending}>Cancel</Button>
          </ResponsiveDialogClose>
          <Button
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={(event) => {
              event.preventDefault();
              startTransition(() => action(sessionId));
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Delete
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
