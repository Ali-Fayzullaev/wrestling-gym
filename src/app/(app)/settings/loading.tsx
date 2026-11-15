import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: header, the gym form, the groups list and two link cards. */
export default function SettingsLoading() {
  return (
    <>
      <PageHeaderSkeleton />
      <Skeleton aria-hidden className="h-80 rounded-xl" />
      <Skeleton aria-hidden className="h-96 rounded-xl" />
      <Skeleton aria-hidden className="h-40 rounded-xl" />
      <Skeleton aria-hidden className="h-36 rounded-xl" />
    </>
  );
}
