// Kept apart from schema.ts so the client form and dialogs do not bundle Zod.

/** Form field names, shared by the form and the parser so they cannot drift apart. */
export const clientFormFields = {
  lastName: "lastName",
  firstName: "firstName",
  birthDate: "birthDate",
  phone: "phone",
  phoneOwner: "phoneOwner",
  parentName: "parentName",
  groupId: "groupId",
  startedOn: "startedOn",
  note: "note",
  consent: "consent",
} as const;

export const PHONE_OWNERS = ["self", "parent"] as const;
export type PhoneOwner = (typeof PHONE_OWNERS)[number];

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
