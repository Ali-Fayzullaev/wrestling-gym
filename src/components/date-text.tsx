import { cn } from "@/lib/utils";

import { businessDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/**
 * "18 ноября" (with the year when it is not the current one). `today` comes from the caller, so a
 * screen renders every date against the same moment and tests can fix it.
 */
export function DateText({
  date,
  today,
  className,
}: {
  date: Date | string;
  today: Date;
  className?: string;
}) {
  const iso = typeof date === "string" ? date : businessDate(date);
  return (
    <time
      dateTime={iso}
      className={cn("whitespace-nowrap tabular-nums", className)}
    >
      {formatDate(date, today)}
    </time>
  );
}
