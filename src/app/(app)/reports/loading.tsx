import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: title with the month switch, two totals, two bar lists, debtors. */
export default function ReportsLoading() {
  return (
    <>
      <div
        aria-hidden
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <Skeleton className="h-8 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-6 w-36" />
          <Skeleton className="size-11 rounded-full" />
        </div>
      </div>
      <div aria-hidden className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-[7.5rem] rounded-xl" />
        <Skeleton className="h-[7.5rem] rounded-xl" />
      </div>
      <div aria-hidden className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex min-h-14 items-center gap-3 px-4 py-3"
            >
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
