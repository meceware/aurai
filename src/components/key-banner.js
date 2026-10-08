import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shown in place of the tools until the user has connected their OpenRouter account. */
export function KeyBanner() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-brand/30 bg-brand/10 p-4 sm:flex-row sm:items-center">
      <KeyRound className="size-5 shrink-0 text-brand" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Add your OpenRouter key to get started</p>
        <p className="text-muted-foreground">Aurai calls the AI models with your own OpenRouter account.</p>
      </div>
      <Button asChild size="sm">
        <Link href="/settings">Add key</Link>
      </Button>
    </div>
  );
}
