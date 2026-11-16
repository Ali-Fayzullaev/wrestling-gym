import { z } from "zod";

import { STAFF_ROLES, type StaffRole } from "./roles";

/** The signed-in active employee's role, and whether a temporary password still has to go. */
export type StaffAccess = { role: StaffRole; mustChangePassword: boolean };

// Shape of current_staff_access() (supabase/migrations/*_staff_passwords.sql).
const accessShape = z.object({
  role: z.enum(STAFF_ROLES),
  must_change_password: z.boolean(),
});

/** Null for a guest, an inactive or unknown user, and anything unexpected (fail closed). */
export function parseStaffAccess(data: unknown): StaffAccess | null {
  const parsed = accessShape.safeParse(data);
  if (!parsed.success) return null;
  return {
    role: parsed.data.role,
    mustChangePassword: parsed.data.must_change_password,
  };
}
