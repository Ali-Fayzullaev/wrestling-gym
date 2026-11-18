import { z } from "zod";

import { LOCALES } from "@/lib/locale";

import { REMINDER_KINDS, TEMPLATE_KINDS } from "./kinds";
import { BODY_MAX, DAYS_MAX, DAYS_MIN } from "./limits";

const id = z.uuid();

// The language chosen for this message (D-17); absent means the one on the card.
const sendLocale = z.enum(LOCALES).optional();
const singleReminder = z.object({
  paymentId: id,
  kind: z.enum(REMINDER_KINDS),
});

/** Children one family message may name; record_family_reminder_opened() agrees. */
export const FAMILY_ITEMS_MAX = 20;

export const openReminderSchema = z.union([
  singleReminder.extend({ locale: sendLocale }).strict(),
  z
    .object({
      parentId: id,
      items: z.array(singleReminder).min(2).max(FAMILY_ITEMS_MAX),
      locale: sendLocale,
    })
    .strict()
    .refine(
      (value) =>
        new Set(value.items.map((item) => item.paymentId)).size ===
        value.items.length,
      { path: ["items"] },
    ),
]);

export const markReminderSentSchema = z.object({ eventId: id });
export type MarkReminderSentInput = z.infer<typeof markReminderSentSchema>;

const distinctItems = (items: { paymentId: string; kind: string }[]) =>
  new Set(items.map((item) => `${item.paymentId}:${item.kind}`)).size ===
  items.length;

/** "Sent" for one message to a parent: the children still to mark (D-18). */
export const markFamilySentSchema = z
  .object({
    parentId: id,
    items: z.array(singleReminder).min(1).max(FAMILY_ITEMS_MAX),
  })
  .strict()
  .refine((value) => distinctItems(value.items), { path: ["items"] });
export type MarkFamilySentInput = z.infer<typeof markFamilySentSchema>;

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
    // One text per kind and language (D-13), the several-children text included (D-18).
    templates: z
      .array(z.object({ id, body }))
      .max(TEMPLATE_KINDS.length * LOCALES.length),
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
