import { PageHeaderSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Same geometry as the screen: back link, header, the days card, variables and three texts. */
export default function ReminderSettingsLoading() {
  return (
    <>
      <Skeleton aria-hidden className="-mb-3 h-11 w-32" />
      <PageHeaderSkeleton />
      <Skeleton aria-hidden className="h-64 rounded-xl" />
      <Skeleton aria-hidden className="h-48 rounded-xl" />
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} aria-hidden className="h-72 rounded-xl" />
      ))}
    </>
  );
}
