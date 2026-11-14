import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the card: header, four blocks, the note, then the two history blocks. */
export default function ClientLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <div aria-hidden className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-36 rounded-xl" />
        ))}
        <Skeleton className="h-24 rounded-xl lg:col-span-2" />
      </div>
    </>
  );
}
