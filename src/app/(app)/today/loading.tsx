import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Header, the row of counters, then the reminder list (step 08 fills them in). */
export default function TodayLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
      <ListSkeleton rows={4} />
    </>
  );
}
