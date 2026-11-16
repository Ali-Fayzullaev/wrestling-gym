import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: back link, header, the add-employee form and the staff list. */
export default function StaffLoading() {
  return (
    <>
      <Skeleton aria-hidden className="-mb-3 h-11 w-32" />
      <PageHeaderSkeleton />
      <Skeleton aria-hidden className="h-[46rem] rounded-xl md:h-[37rem]" />
      <ListSkeleton rows={3} />
    </>
  );
}
