import { businessDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/lib/locale";

/**
 * "18 ноября" (with the year when it is not the current one). `today` comes from the caller, so a
 * screen renders every date against the same moment and tests can fix it. No class merging, so
 * client islands can use it.
 */
export function DateText({
  date,
  today,
  locale,
  className,
}: {
  date: Date | string;
  today: Date;
  locale: Locale;
  className?: string;
}) {
  const iso = typeof date === "string" ? date : businessDate(date);
  return (
    <time
      dateTime={iso}
      className={`whitespace-nowrap tabular-nums ${className ?? ""}`}
    >
      {formatDate(date, today, locale)}
    </time>
  );
}
