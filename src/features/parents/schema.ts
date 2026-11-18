import { z } from "zod";

import { LOCALES } from "@/lib/locale";
import { normalizePhone } from "@/lib/phone";

import {
  PARENT_NAME_MAX,
  PARENT_NOTE_MAX,
  PARENT_QUERY_MAX,
  parentFormFields,
} from "./form-fields";

export const parentInputSchema = z.object({
  name: z.string().trim().min(1).max(PARENT_NAME_MAX),
  /** Typed in any usual way; stored as +77XXXXXXXXX. */
  phone: z.string().transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (phone === null) {
      ctx.addIssue({ code: "custom" });
      return z.NEVER;
    }
    return phone;
  }),
  messageLocale: z.enum(LOCALES),
  note: z.string().max(PARENT_NOTE_MAX),
});

export type ParentInput = z.infer<typeof parentInputSchema>;
export type ParentField = keyof ParentInput;

export const parentIdSchema = z.uuid();

export const parentSearchSchema = z.object({
  query: z.string().max(PARENT_QUERY_MAX),
});

/** The raw shape for parentInputSchema from the parent form. */
export function parentFormToRaw(form: FormData): Record<string, unknown> {
  const text = (field: string) => {
    const value = form.get(field);
    return typeof value === "string" ? value : "";
  };
  const f = parentFormFields;
  return {
    name: text(f.name),
    phone: text(f.phone),
    messageLocale: text(f.messageLocale),
    note: text(f.note),
  };
}
