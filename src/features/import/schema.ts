import { z } from "zod";

import { GROUP_PRICE_MAX, MAX_NEW_GROUPS } from "./limits";

// The sheet reader keeps at most 100 columns (xlsx.ts); CSV rows are cut the same way here.
const columnIndex = z.number().int().min(0).max(99).nullable();

export const mappingSchema = z
  .object({
    lastName: columnIndex,
    firstName: columnIndex,
    phone: columnIndex,
    group: columnIndex,
    endsOn: columnIndex,
    locale: columnIndex,
    parent: columnIndex,
  })
  .refine((mapping) => {
    const used = Object.values(mapping).filter((index) => index !== null);
    return new Set(used).size === used.length;
  });

const groupChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("existing"), groupId: z.uuid() }),
  z.object({
    kind: z.literal("create"),
    coachId: z.uuid(),
    price: z.number().int().min(1).max(GROUP_PRICE_MAX),
  }),
]);

export const groupChoicesSchema = z
  .record(z.string().max(100), groupChoiceSchema)
  .refine((choices) => Object.keys(choices).length <= MAX_NEW_GROUPS * 4);

/** JSON text from a form field, or undefined when it is not JSON. */
export function parseJsonField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
