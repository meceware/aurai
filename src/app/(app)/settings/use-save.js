'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { savePreferences } from './actions';

/** Preferences save as soon as they change — no Save button to forget. */
export function usePrefs(initial, { onSaved } = {}) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();

  const update = (patch) => {
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    startTransition(async () => {
      const result = await savePreferences(patch);
      if (result?.error) {
        setPrefs(previous);
        toast.error(result.error);
      } else {
        setPrefs(result.prefs);
        toast.success('Saved', { id: 'prefs-saved', duration: 1200 });
        onSaved?.(result.prefs);
      }
    });
  };

  // `replace` takes preferences another action already saved.
  return [prefs, update, pending, setPrefs];
}
