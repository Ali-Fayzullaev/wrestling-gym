import { ListSkeleton, PageHeaderSkeleton } from "@/components/list-skeleton";

/** Same geometry as a list screen: header, then rows. */
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <ListSkeleton />
    </>
  );
}
