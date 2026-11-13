import { z } from "zod";

import { groupFormFields, WEEK_DAYS } from "./form-fields";

export const NAME_MAX = 100;
/** Generous upper bounds that still catch a typo with extra zeros. */
export const PRICE_MAX = 1_000_000;
export const CAPACITY_MAX = 500;
/** One transfer at a time is a group or two of 20–30 people, never thousands. */
export const MOVE_MAX = 300;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const sessionSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    start: z.string().regex(TIME),
    end: z.string().regex(TIME),
  })
  // "HH:MM" strings compare in time order.
  .refine((session) => session.end > session.start, { path: ["end"] });

export type Session = z.infer<typeof sessionSchema>;

/** Whole tenge typed by a person: "15 000" and "15000" are the same, "15.5" is not a price. */
const wholeNumber = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/[\s ]/g, "") : value),
  z.union([
    z.number(),
    z
      .string()
      .regex(/^-?\d+$/)
      .transform(Number),
  ]),
);

const optionalWholeNumber = z.preprocess(
  (value) =>
    value === "" || value === null || value === undefined ? null : value,
  z.union([z.null(), wholeNumber]),
);

export const groupInputSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  coachId: z.uuid(),
  schedule: z
    .array(sessionSchema)
    .max(WEEK_DAYS.length)
    .refine(
      (sessions) =>
        new Set(sessions.map((s) => s.day)).size === sessions.length,
    )
    .transform((sessions) => [...sessions].sort((a, b) => a.day - b.day)),
  defaultPrice: wholeNumber.pipe(z.number().int().min(1).max(PRICE_MAX)),
  /** Seats; null means no limit. */
  capacity: optionalWholeNumber.pipe(
    z.union([z.null(), z.number().int().min(1).max(CAPACITY_MAX)]),
  ),
});

export type GroupInput = z.infer<typeof groupInputSchema>;
export type GroupField = keyof GroupInput;

export const groupIdSchema = z.uuid();

export const archiveGroupSchema = z.object({
  groupId: z.uuid(),
  /** The owner has seen the warning that the group still has clients. */
  force: z.boolean(),
});

export type ArchiveGroupInput = z.infer<typeof archiveGroupSchema>;

export const moveClientsSchema = z.object({
  clientIds: z
    .array(z.uuid())
    .min(1)
    .max(MOVE_MAX)
    .transform((ids) => [...new Set(ids)]),
  targetGroupId: z.uuid(),
});

export type MoveClientsInput = z.infer<typeof moveClientsSchema>;

/**
 * The raw shape for groupInputSchema from the group form: one checkbox and two time fields per
 * week day; only ticked days become sessions.
 */
export function groupFormToRaw(form: FormData): Record<string, unknown> {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text(groupFormFields.name),
    coachId: text(groupFormFields.coachId),
    defaultPrice: text(groupFormFields.defaultPrice),
    capacity: text(groupFormFields.capacity),
    schedule: WEEK_DAYS.filter((day) => form.has(groupFormFields.day(day))).map(
      (day) => ({
        day,
        start: text(groupFormFields.start(day)),
        end: text(groupFormFields.end(day)),
      }),
    ),
  };
}
