import { z } from "zod";

import { REMINDER_KINDS } from "./kinds";
import { BODY_MAX, DAYS_MAX, DAYS_MIN } from "./limits";

const id = z.uuid();

export const openReminderSchema = z.object({
  paymentId: id,
  kind: z.enum(REMINDER_KINDS),
});

export const markReminderSentSchema = z.object({ eventId: id });
export type MarkReminderSentInput = z.infer<typeof markReminderSentSchema>;

const days = z.coerce.number().int().min(DAYS_MIN).max(DAYS_MAX);

const emptyToNull = (value: unknown) =>
  value === "" || value === null || value === undefined ? null : value;

/** Browsers send textarea line breaks as \r\n; the stored text uses \n. */
const body = z
  .string()
  .transform((text) => text.replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().min(1).max(BODY_MAX));

export const reminderSettingsSchema = z
  .object({
    firstDays: days,
    secondDays: z.preprocess(emptyToNull, days.nullable()),
    templates: z.array(z.object({ id, body })).max(REMINDER_KINDS.length),
  })
  .refine(
    (value) => value.secondDays === null || value.secondDays < value.firstDays,
    { path: ["secondDays"] },
  )
  .refine(
    (value) =>
      new Set(value.templates.map((template) => template.id)).size ===
      value.templates.length,
    { path: ["templates"] },
  );
export type ReminderSettingsInput = z.infer<typeof reminderSettingsSchema>;

/** The early reminder first, as settings.reminder_days stores it. */
export function reminderDaysOf(input: ReminderSettingsInput): number[] {
  return input.secondDays === null
    ? [input.firstDays]
    : [input.firstDays, input.secondDays];
}

/** History filters from the address bar; anything malformed is dropped, not an error. */
export const historyFilterSchema = z.object({
  date: z.iso.date().optional().catch(undefined),
  staff: id.optional().catch(undefined),
});
export type HistoryFilter = z.infer<typeof historyFilterSchema>;
