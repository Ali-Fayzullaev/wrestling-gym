// Kept apart from schema.ts so the client form and dialogs do not bundle Zod.

/** Form field names, shared by the form and the parser so they cannot drift apart. */
export const clientFormFields = {
  lastName: "lastName",
  firstName: "firstName",
  birthDate: "birthDate",
  phone: "phone",
  kind: "kind",
  parentMode: "parentMode",
  parentId: "parentId",
  newParentName: "newParentName",
  newParentPhone: "newParentPhone",
  newParentLocale: "newParentLocale",
  groupId: "groupId",
  startedOn: "startedOn",
  note: "note",
  messageLocale: "messageLocale",
  consent: "consent",
} as const;

/** An adult is reminded on their own phone; a child through the parent (D-18). */
export const CLIENT_KINDS = ["adult", "child"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

/** A child's parent: one already on file, or a new one entered with the child. */
export const PARENT_MODES = ["existing", "new"] as const;
export type ParentMode = (typeof PARENT_MODES)[number];

/** consents.kind in the database. STUB(D-10): the consent texts await legal review. */
export const CONSENT_KINDS = ["data_processing", "messaging"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/**
 * Why a client was fully deleted. A fixed list, not free text: the reason goes into the audit
 * log, which must never hold personal data.
 */
export const DELETE_REASONS = [
  "duplicate",
  "created_by_mistake",
  "client_request",
  "other",
] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

export const NAME_MAX = 100;
export const NOTE_MAX = 2000;

/** Typed last name matches the client's: the same check delete_client() makes. */
export function lastNameConfirmed(typed: string, lastName: string): boolean {
  return typed.trim().toLowerCase() === lastName.trim().toLowerCase();
}
