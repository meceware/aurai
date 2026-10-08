import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-8">
        <Skeleton className="h-9 w-full max-w-md rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </>
  );
}
