import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the group cards, so the list replaces it without a jump. */
export default function GroupsLoading() {
  return (
    <>
      <PageHeaderSkeleton mascot />
      <div aria-hidden className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[11.5rem] rounded-xl" />
        ))}
      </div>
    </>
  );
}
