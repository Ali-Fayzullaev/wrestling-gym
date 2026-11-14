import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: header, four counters, the list switch, reminder rows. */
export default function TodayLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-[6.875rem] rounded-xl md:h-[5.625rem]"
          />
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-11 w-44 rounded-full" />
          <Skeleton className="h-11 w-40 rounded-full" />
        </div>
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-h-11 flex-col justify-center gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-56" />
              </div>
              <div className="grid grid-cols-2 gap-2 md:w-[17rem]">
                <Skeleton className="h-11" />
                <Skeleton className="h-11" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
