import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

import {
  clientFormFields,
  CONSENT_KINDS,
  DELETE_REASONS,
  NAME_MAX,
  NOTE_MAX,
  PHONE_OWNERS,
} from "./form-fields";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date "YYYY-MM-DD" (rejects 2026-02-30) within sane years. */
const calendarDate = z
  .string()
  .regex(ISO_DATE)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    const year = date.getUTCFullYear();
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().startsWith(value) &&
      year >= 1900 &&
      year <= 2100
    );
  });

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const name = z.string().trim().min(1).max(NAME_MAX);

export const clientInputSchema = z
  .object({
    lastName: name,
    firstName: name,
    birthDate: z.preprocess(emptyToNull, calendarDate.nullable()),
    /** Typed in any usual way; stored as +77XXXXXXXXX. */
    phone: z.string().transform((value, ctx) => {
      const phone = normalizePhone(value);
      if (phone === null) {
        ctx.addIssue({ code: "custom" });
        return z.NEVER;
      }
      return phone;
    }),
    phoneOwner: z.enum(PHONE_OWNERS),
    parentName: z.preprocess(emptyToNull, name.nullable()),
    groupId: z.preprocess(emptyToNull, z.uuid().nullable()),
    startedOn: calendarDate,
    note: z.string().max(NOTE_MAX),
    /** Consents given now; ones already on file are kept by the database, never withdrawn here. */
    consents: z
      .array(z.enum(CONSENT_KINDS))
      .max(10)
      .transform((kinds) => [...new Set(kinds)]),
  })
  // A child's phone belongs to a parent; reminders address the parent by name.
  .refine((input) => input.phoneOwner === "self" || input.parentName !== null, {
    path: ["parentName"],
  })
  .transform((input) => ({
    ...input,
    parentName: input.phoneOwner === "parent" ? input.parentName : null,
  }));

export type ClientInput = z.infer<typeof clientInputSchema>;
export type ClientField = keyof ClientInput;

export const clientIdSchema = z.uuid();

export const phoneCheckSchema = z.object({
  phone: z.string().max(40),
  excludeId: z.uuid().nullable(),
});

export type PhoneCheckInput = z.infer<typeof phoneCheckSchema>;

export const archiveClientSchema = z.object({
  clientId: z.uuid(),
  archived: z.boolean(),
});

export type ArchiveClientInput = z.infer<typeof archiveClientSchema>;

export const deleteClientSchema = z.object({
  clientId: z.uuid(),
  reason: z.enum(DELETE_REASONS),
  /** The client's last name as typed by the owner to confirm. */
  lastName: z.string().trim().min(1).max(NAME_MAX),
});

export type DeleteClientInput = z.infer<typeof deleteClientSchema>;

/** The raw shape for clientInputSchema from the client form. */
export function clientFormToRaw(form: FormData): Record<string, unknown> {
  const text = (field: string) => {
    const value = form.get(field);
    return typeof value === "string" ? value : "";
  };
  const f = clientFormFields;
  return {
    lastName: text(f.lastName),
    firstName: text(f.firstName),
    birthDate: text(f.birthDate),
    phone: text(f.phone),
    phoneOwner: text(f.phoneOwner),
    parentName: text(f.parentName),
    groupId: text(f.groupId),
    startedOn: text(f.startedOn),
    note: text(f.note),
    consents: form
      .getAll(f.consent)
      .filter((value): value is string => typeof value === "string"),
  };
}
