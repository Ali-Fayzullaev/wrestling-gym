/** Reminder kinds name a meaning, not a day count: the days come from settings.reminder_days. */
export const REMINDER_KINDS = ["before_7", "before_1", "overdue"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * Kinds of a template: the reminder kinds, and "family", the one message to a parent with several
 * children due on the same day (D-18). Events keep the reminder kind of each child.
 */
export const TEMPLATE_KINDS = [...REMINDER_KINDS, "family"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type ReminderStatus = "chat_opened" | "marked_sent";

/**
 * Kinds that exist with these settings, in the order they happen: one configured day gives only the
 * early reminder; the last day of the subscription always has one.
 */
export function activeKinds(reminderDays: readonly number[]): ReminderKind[] {
  return reminderDays.length > 1
    ? ["before_7", "before_1", "overdue"]
    : ["before_7", "overdue"];
}

/** How many days before the end a kind is sent: the larger day is early, the smaller late. */
export function daysForKind(
  kind: ReminderKind,
  reminderDays: readonly number[],
): number {
  if (kind === "overdue") return 0;
  const sorted = [...reminderDays].sort((a, b) => b - a);
  return (kind === "before_7" ? sorted[0] : sorted[1]) ?? 0;
}
