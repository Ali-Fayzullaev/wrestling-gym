import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: back link, header, the invite form and the staff list. */
export default function StaffLoading() {
  return (
    <>
      <Skeleton aria-hidden className="-mb-3 h-11 w-32" />
      <PageHeaderSkeleton />
      <Skeleton aria-hidden className="h-[26rem] rounded-xl" />
      <ListSkeleton rows={3} />
    </>
  );
}
