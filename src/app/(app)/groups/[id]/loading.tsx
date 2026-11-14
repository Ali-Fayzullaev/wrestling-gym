import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Back link, header, the four counters, then the client list. */
export default function GroupLoading() {
  return (
    <>
      <Skeleton aria-hidden className="-mb-3 h-11 w-24" />
      <PageHeaderSkeleton />
      <div aria-hidden className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[5.25rem] rounded-xl" />
        ))}
      </div>
      <ListSkeleton rows={6} />
    </>
  );
}
