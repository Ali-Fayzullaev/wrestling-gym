import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder rows with the geometry of a list row (two text lines and a badge), so the real list
 * replaces it without a layout shift.
 */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className="flex flex-col divide-y rounded-xl border bg-card"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-16 items-center gap-3 px-4 py-3">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Title line of a screen while it loads (matches PageHeader). */
export function PageHeaderSkeleton({ mascot = false }: { mascot?: boolean }) {
  const title = (
    <div className="flex flex-col gap-1">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-5 w-64 max-w-full" />
    </div>
  );
  if (!mascot) return <div aria-hidden>{title}</div>;
  // Same place and size as the mascot in PageHeader, so the screen does not jump when it arrives.
  return (
    <div aria-hidden className="flex items-center gap-3">
      <Skeleton className="size-12 shrink-0 rounded-full md:size-14" />
      {title}
    </div>
  );
}
