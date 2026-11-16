import { plural } from "@/i18n/format";
import type { I18n } from "@/i18n/messages";
import { businessDate } from "@/lib/dates";
import { formatDate, formatTime } from "@/lib/format";
import type { Locale } from "@/lib/locale";

import { daysForKind, type ReminderKind } from "./kinds";

/** "Первое напоминание (за 7 дней)", "Второе (за 1 день)", "В день окончания". */
export function kindLabel(
  { t, locale }: I18n,
  kind: ReminderKind,
  reminderDays: readonly number[],
): string {
  const kinds = t.reminders.kinds;
  if (kind === "overdue") return kinds.overdue;
  const days = daysForKind(kind, reminderDays);
  return plural(locale, kind === "before_7" ? kinds.first : kinds.second, days);
}

/** "14:32" for today, "12 ноября, 14:32" for another day, in Asia/Almaty. */
export function formatWhen(iso: string, now: Date, locale: Locale): string {
  const at = new Date(iso);
  return businessDate(at) === businessDate(now)
    ? formatTime(at)
    : `${formatDate(at, now, locale)}, ${formatTime(at)}`;
}
