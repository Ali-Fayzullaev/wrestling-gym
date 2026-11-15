import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: header, the filter form and the entries. */
export default function AuditLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <Skeleton aria-hidden className="h-48 rounded-xl md:h-28" />
      <ListSkeleton rows={8} />
    </>
  );
}
