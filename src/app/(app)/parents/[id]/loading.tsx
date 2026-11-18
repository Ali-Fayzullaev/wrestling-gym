import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the card: header, the contacts block, then the children. */
export default function ParentLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div aria-hidden className="grid gap-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </>
  );
}
