'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHydrated } from '@/lib/hooks';

export function ModeToggle({ className }) {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // The resolved theme is unknown on the server, so everything derived from it has to
  // wait for hydration or the markup will not match what hydrates.
  const dark = hydrated && resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label={hydrated ? (dark ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}
