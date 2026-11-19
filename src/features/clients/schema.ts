import { z } from "zod";

import { DEFAULT_LOCALE, type Locale, LOCALES } from "@/lib/locale";
import { normalizePhone } from "@/lib/phone";

import {
  CHILD_FIELDS,
  type ChildField,
  childFieldName,
  CHILDREN_MAX,
  childrenFormFields,
  CLIENT_KINDS,
  clientFormFields,
  type ClientKind,
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
  | "messageLocale";

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

/** One child of the several-children form (D-24): the same rules as a child in the client form. */
const childInputSchema = z.object({
  lastName: name,
  firstName: name,
  phone: optionalPhone,
  groupId: z.preprocess(emptyToNull, z.uuid().nullable()),
  startedOn: calendarDate,
  birthDate: z.preprocess(emptyToNull, calendarDate.nullable()),
  note: z.string().max(NOTE_MAX),
});

export type ChildInput = z.infer<typeof childInputSchema>;

/** A child's parent in the several-children form: never "none". */
export type ChildrenParent = Exclude<ParentInput, null>;

/** A new parent, or one on file, and 1 to CHILDREN_MAX children, saved together. */
export const childrenInputSchema = z
  .object({
    parentMode: z.enum(PARENT_MODES).catch("existing"),
    parentId: z.preprocess(emptyToNull, z.uuid().nullable()),
    newParentName: z.preprocess(emptyToNull, name.nullable()),
    newParentPhone: optionalPhone,
    newParentLocale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
    requestKey: z.uuid(),
    children: z.array(childInputSchema).min(1).max(CHILDREN_MAX),
  })
  .transform((input, ctx) => {
    const parent = parentOf({ ...input, kind: "child" });
    if (parent === null) {
      const fields: ClientField[] =
        input.parentMode === "existing"
          ? ["parentId"]
          : [
              ...(input.newParentName === null
                ? (["newParentName"] as const)
                : []),
              ...(input.newParentPhone === null
                ? (["newParentPhone"] as const)
                : []),
            ];
      for (const field of fields)
        ctx.addIssue({ code: "custom", path: [field] });
      return z.NEVER;
    }
    return {
      parent,
      children: input.children,
      requestKey: input.requestKey,
    };
  });

export type ChildrenInput = z.infer<typeof childrenInputSchema>;

/** A wrong field of one child, by the child's place in the form. */
export type ChildFieldIssue = { index: number; field: ChildField };

const CHILD_FIELD_SET = new Set<string>(CHILD_FIELDS);
const PARENT_FIELD_SET = new Set<string>([
  "parentId",
  "newParentName",
  "newParentPhone",
  "newParentLocale",
]);

/**
 * Which parent fields and which children's fields are wrong; the values never leave the form. A
 * wrong count of children (none, too many) names no field.
 */
export function childrenIssues(issues: { path: PropertyKey[] }[]): {
  fields: ClientField[];
  childFields: ChildFieldIssue[];
} {
  const fields = new Set<ClientField>();
  const childFields = new Map<string, ChildFieldIssue>();
  for (const { path } of issues) {
    const [first, index, field] = path;
    if (typeof first === "string" && PARENT_FIELD_SET.has(first))
      fields.add(first as ClientField);
    if (
      first === "children" &&
      typeof index === "number" &&
      typeof field === "string" &&
      CHILD_FIELD_SET.has(field)
    )
      childFields.set(`${index}.${field}`, {
        index,
        field: field as ChildField,
      });
  }
  return { fields: [...fields], childFields: [...childFields.values()] };
}

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
  };
}

/**
 * The raw shape for childrenInputSchema. Children are read by their place in the form; places past
 * CHILDREN_MAX are kept as far as one more, so a longer list is refused rather than cut.
 */
export function childrenFormToRaw(form: FormData): Record<string, unknown> {
  const text = (field: string) => {
    const value = form.get(field);
    return typeof value === "string" ? value : "";
  };
  const f = clientFormFields;
  let count = 0;
  for (const key of form.keys()) {
    const match = /^children\.(\d{1,2})\./.exec(key);
    if (match) count = Math.max(count, Number(match[1]) + 1);
  }
  const children = Array.from(
    { length: Math.min(count, CHILDREN_MAX + 1) },
    (_, index) =>
      Object.fromEntries(
        CHILD_FIELDS.map((field) => [
          field,
          text(childFieldName(index, field)),
        ]),
      ),
  );
  return {
    parentMode: text(f.parentMode),
    parentId: text(f.parentId),
    newParentName: text(f.newParentName),
    newParentPhone: text(f.newParentPhone),
    newParentLocale: text(f.newParentLocale),
    requestKey: text(childrenFormFields.requestKey),
    children,
  };
}
