// Kept apart from schema.ts so the client form does not bundle Zod.

/** ISO week days, Monday = 1, as stored in groups.schedule. */
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

/** Form field names, shared by the form and the parser so they cannot drift apart. */
export const groupFormFields = {
  name: "name",
  coachId: "coachId",
  defaultPrice: "defaultPrice",
  capacity: "capacity",
  day: (day: WeekDay) => `day-${day}`,
  start: (day: WeekDay) => `start-${day}`,
  end: (day: WeekDay) => `end-${day}`,
} as const;
