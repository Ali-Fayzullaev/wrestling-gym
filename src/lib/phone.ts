/** What the database accepts (clients.phone check): a Kazakhstan mobile number. */
export const PHONE_PATTERN = /^\+77\d{9}$/;

// Spaces, brackets, dashes and dots people type between digit groups.
const SEPARATORS = /[\s()\-. ]/g;

/**
 * Brings a typed phone to `+77XXXXXXXXX`, or returns null when it is not a Kazakhstan mobile.
 * Accepts the usual ways of writing one: `8 701 123 45 67`, `+7(701)1234567`, `7011234567`.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(SEPARATORS, "");
  let digits: string;
  if (/^\+7\d{10}$/.test(compact)) digits = compact.slice(2);
  else if (/^[78]\d{10}$/.test(compact)) digits = compact.slice(1);
  else if (/^\d{10}$/.test(compact)) digits = compact;
  else return null;
  const phone = `+7${digits}`;
  return PHONE_PATTERN.test(phone) ? phone : null;
}

/** `+77011234567` as `+7 701 123 45 67`, for reading on a screen. */
export function formatPhone(phone: string): string {
  if (!PHONE_PATTERN.test(phone)) return phone;
  return `+7 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8, 10)} ${phone.slice(10)}`;
}
