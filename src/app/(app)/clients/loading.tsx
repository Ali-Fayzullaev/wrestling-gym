import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the list: header, search, filters, count, rows. */
export default function ClientsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-11 rounded-md" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton
              key={index}
              className={`h-11 rounded-md ${index === 4 ? "col-span-2 md:col-span-1" : ""}`}
            />
          ))}
        </div>
        <Skeleton className="my-3.5 h-4 w-28" />
        <ListSkeleton rows={8} />
      </div>
    </>
  );
}
