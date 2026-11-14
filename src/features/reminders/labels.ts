import { remindersText } from "@/i18n/reminders";
import { businessDate } from "@/lib/dates";
import { formatDate, formatTime } from "@/lib/format";

import { daysForKind, type ReminderKind } from "./kinds";

/** "Первое напоминание (за 7 дней)", "Второе (за 1 день)", "В день окончания". */
export function kindLabel(
  kind: ReminderKind,
  reminderDays: readonly number[],
): string {
  if (kind === "overdue") return remindersText.kinds.overdue;
  const days = daysForKind(kind, reminderDays);
  return kind === "before_7"
    ? remindersText.kinds.first(days)
    : remindersText.kinds.second(days);
}

/** "14:32" for today, "12 ноября, 14:32" for another day, in Asia/Almaty. */
export function formatWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  return businessDate(at) === businessDate(now)
    ? formatTime(at)
    : `${formatDate(at, now)}, ${formatTime(at)}`;
}
