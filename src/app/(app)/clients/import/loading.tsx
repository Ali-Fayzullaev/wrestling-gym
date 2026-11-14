import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: back link, header and the file card. */
export default function ClientImportLoading() {
  return (
    <>
      <Skeleton aria-hidden className="-mb-3 h-11 w-32" />
      <PageHeaderSkeleton />
      <Skeleton aria-hidden className="h-52 rounded-xl" />
    </>
  );
}
