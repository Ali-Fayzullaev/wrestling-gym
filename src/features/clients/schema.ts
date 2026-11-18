import { z } from "zod";

import { DEFAULT_LOCALE, type Locale, LOCALES } from "@/lib/locale";
import { normalizePhone } from "@/lib/phone";

import {
  CLIENT_KINDS,
  clientFormFields,
  type ClientKind,
  CONSENT_KINDS,
  DELETE_REASONS,
  NAME_MAX,
  NOTE_MAX,
  PARENT_MODES,
  type ParentMode,
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

/** The parent fields are absent for an adult (the form shows them for a child only). */
const absentToEmpty = (value: unknown) => value ?? "";

const name = z.string().trim().min(1).max(NAME_MAX);

/** Typed in any usual way; stored as +77XXXXXXXXX. Empty is null; a wrong number is an issue. */
const optionalPhone = z.string().transform((value, ctx) => {
  if (value.trim() === "") return null;
  const phone = normalizePhone(value);
  if (phone === null) {
    ctx.addIssue({ code: "custom" });
    return z.NEVER;
  }
  return phone;
});

/** The parent of a client being saved: none (an adult), one on file, or a new one. */
export type ParentInput =
  | null
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string; phone: string; messageLocale: Locale };

/** Form fields of the client form; issues name these, the values never leave the form. */
export type ClientField =
  | "lastName"
  | "firstName"
  | "birthDate"
  | "phone"
  | "kind"
  | "parentId"
  | "newParentName"
  | "newParentPhone"
  | "newParentLocale"
  | "groupId"
  | "startedOn"
  | "note"
  | "messageLocale"
  | "consents";

export const clientInputSchema = z
  .object({
    lastName: name,
    firstName: name,
    birthDate: z.preprocess(emptyToNull, calendarDate.nullable()),
    /** Required for an adult; a child may have a phone of their own or none (D-18). */
    phone: optionalPhone,
    kind: z.enum(CLIENT_KINDS),
    parentMode: z.enum(PARENT_MODES).catch("existing"),
    parentId: z.preprocess(
      (value) => emptyToNull(absentToEmpty(value)),
      z.uuid().nullable(),
    ),
    newParentName: z.preprocess(
      (value) => emptyToNull(absentToEmpty(value)),
      name.nullable(),
    ),
    newParentPhone: z.preprocess(absentToEmpty, optionalPhone),
    newParentLocale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
    groupId: z.preprocess(emptyToNull, z.uuid().nullable()),
    startedOn: calendarDate,
    note: z.string().max(NOTE_MAX),
    /** The language of an adult's WhatsApp reminders (D-13); a child's go in the parent's. */
    messageLocale: z.enum(LOCALES),
    /** Consents given now; ones already on file are kept by the database, never withdrawn here. */
    consents: z
      .array(z.enum(CONSENT_KINDS))
      .max(10)
      .transform((kinds) => [...new Set(kinds)]),
  })
  .superRefine((input, ctx) => {
    const missing = (field: ClientField) =>
      ctx.addIssue({ code: "custom", path: [field] });
    if (input.kind === "adult") {
      // The database refuses it too (clients_phone_or_parent).
      if (input.phone === null) missing("phone");
      return;
    }
    if (input.parentMode === "existing") {
      if (input.parentId === null) missing("parentId");
      return;
    }
    if (input.newParentName === null) missing("newParentName");
    if (input.newParentPhone === null) missing("newParentPhone");
  })
  .transform((input) => ({
    lastName: input.lastName,
    firstName: input.firstName,
    birthDate: input.birthDate,
    phone: input.phone,
    parent: parentOf(input),
    groupId: input.groupId,
    startedOn: input.startedOn,
    note: input.note,
    messageLocale: input.messageLocale,
    consents: input.consents,
  }));

function parentOf(input: {
  kind: ClientKind;
  parentMode: ParentMode;
  parentId: string | null;
  newParentName: string | null;
  newParentPhone: string | null;
  newParentLocale: Locale;
}): ParentInput {
  if (input.kind === "adult") return null;
  if (input.parentMode === "existing")
    return input.parentId === null
      ? null
      : { kind: "existing", id: input.parentId };
  return input.newParentName === null || input.newParentPhone === null
    ? null
    : {
        kind: "new",
        name: input.newParentName,
        phone: input.newParentPhone,
        messageLocale: input.newParentLocale,
      };
}

export type ClientInput = z.infer<typeof clientInputSchema>;

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
    kind: text(f.kind),
    parentMode: text(f.parentMode),
    parentId: text(f.parentId),
    newParentName: text(f.newParentName),
    newParentPhone: text(f.newParentPhone),
    newParentLocale: text(f.newParentLocale),
    groupId: text(f.groupId),
    startedOn: text(f.startedOn),
    note: text(f.note),
    messageLocale: text(f.messageLocale),
    consents: form
      .getAll(f.consent)
      .filter((value): value is string => typeof value === "string"),
  };
}
