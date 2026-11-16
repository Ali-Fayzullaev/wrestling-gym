import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: header, hint, tabs, reminder rows with two buttons. */
export default function RemindersLoading() {
  return (
    <>
      <PageHeaderSkeleton mascot />
      <Skeleton aria-hidden className="h-[2.875rem] rounded-xl" />
      <div aria-hidden className="flex gap-2">
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-36 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-7 w-48" />
        <div className="flex flex-col divide-y rounded-xl border bg-card">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3.5 w-64 max-w-full" />
              </div>
              <div className="grid grid-cols-2 gap-2 md:w-[17rem]">
                <Skeleton className="h-11" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
