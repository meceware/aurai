import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-8 text-center">
      <div className="space-y-4">
        <Logo className="mx-auto size-10" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Nothing here</h1>
          <p className="text-sm text-muted-foreground">This page does not exist, or the photo was deleted.</p>
        </div>
        <Button asChild>
          <Link href="/enhance">Go to Enhance</Link>
        </Button>
      </div>
    </main>
  );
}
