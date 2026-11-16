import { z } from "zod";

import { DEFAULT_LOCALE, type Locale, parseLocale } from "@/lib/locale";

import { STAFF_ROLES, type StaffRole } from "./roles";

/**
 * The signed-in active employee's role, whether a temporary password still has to go, and the
 * interface language from their profile.
 */
export type StaffAccess = {
  role: StaffRole;
  mustChangePassword: boolean;
  locale: Locale;
};

// Shape of current_staff_access() (supabase/migrations/*_staff_passwords.sql).
const accessShape = z.object({
  role: z.enum(STAFF_ROLES),
  must_change_password: z.boolean(),
  // Optional so a proxy deployed a moment before the migration still lets everyone in.
  locale: z.string().optional(),
});

/** Null for a guest, an inactive or unknown user, and anything unexpected (fail closed). */
export function parseStaffAccess(data: unknown): StaffAccess | null {
  const parsed = accessShape.safeParse(data);
  if (!parsed.success) return null;
  return {
    role: parsed.data.role,
    mustChangePassword: parsed.data.must_change_password,
    locale: parseLocale(parsed.data.locale ?? DEFAULT_LOCALE),
  };
}
