import { Skeleton } from '@/components/ui/skeleton';

/** Shown while a photo page loads: the shape of the page, so nothing jumps when it arrives. */
export function SessionSkeleton() {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 md:px-8">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mx-auto aspect-[4/3] max-h-[60vh] w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </>
  );
}
