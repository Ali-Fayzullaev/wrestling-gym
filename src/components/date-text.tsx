import { businessDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/**
 * "18 ноября" (with the year when it is not the current one). `today` comes from the caller, so a
 * screen renders every date against the same moment and tests can fix it. No class merging, so
 * client islands can use it.
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
      className={`whitespace-nowrap tabular-nums ${className ?? ""}`}
    >
      {formatDate(date, today)}
    </time>
  );
}
