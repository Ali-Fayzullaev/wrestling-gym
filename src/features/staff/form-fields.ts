// Shared by the staff forms (browser) and the server checks; no Zod here, so the forms stay small.

export const STAFF_NAME_MAX = 100;

export type StaffField = "email" | "fullName" | "role";

/** Errors staff changes report: codes only, never internal details or personal data. */
export type StaffError =
  | "forbidden"
  | "invalid"
  | "email_taken"
  | "not_found"
  | "last_owner"
  | "self_change"
  | "unavailable";

export type StaffResult =
  { ok: true } | { ok: false; error: StaffError; fields?: StaffField[] };
