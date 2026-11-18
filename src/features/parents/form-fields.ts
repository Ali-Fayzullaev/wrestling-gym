// Kept apart from schema.ts so the parent form does not bundle Zod.

/** Form field names, shared by the form and the parser so they cannot drift apart. */
export const parentFormFields = {
  name: "name",
  phone: "phone",
  messageLocale: "messageLocale",
  note: "note",
} as const;

export const PARENT_NAME_MAX = 100;
export const PARENT_NOTE_MAX = 2000;
/** Shortest search text: one letter would list everybody. */
export const PARENT_QUERY_MIN = 2;
export const PARENT_QUERY_MAX = 100;
