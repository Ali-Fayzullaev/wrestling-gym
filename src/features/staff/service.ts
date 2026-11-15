import { z } from "zod";

import type { Db } from "@/db/client";
import { STAFF_ROLES, type StaffRole } from "@/features/auth/roles";

import type { StaffError, StaffResult } from "./form-fields";
import type { InviteStaffInput, StaffAccessInput } from "./schema";

export type StaffMember = {
  id: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
  email: string;
  /** Has not signed in yet: the invitation is still open. */
  invited: boolean;
};

// Shape of staff_screen() (supabase/migrations/*_audit_settings_staff.sql).
const staffShape = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    role: z.enum(STAFF_ROLES),
    active: z.boolean(),
    email: z.string(),
    invited: z.boolean(),
  }),
);

/** Everyone who ever had access, active first. Owner only (emails are personal data). */
export async function listStaff(db: Db): Promise<StaffMember[]> {
  const { data, error } = await db.rpc("staff_screen");
  if (error) throw new Error(`staff_screen failed: ${error.code}`);
  return staffShape.parse(data).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    role: row.role,
    active: row.active,
    email: row.email,
    invited: row.invited,
  }));
}

function staffError(error: { code?: string; message?: string }): StaffError {
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0002") return "not_found";
  if (error.code === "P0001" && error.message === "last_owner")
    return "last_owner";
  if (error.code === "P0001" && error.message === "self_change")
    return "self_change";
  if (error.code === "22023" || error.code === "23514") return "invalid";
  return "unavailable";
}

/**
 * Invites an employee: Supabase Auth creates the user and emails a link to set a password
 * (`admin` is the service_role client, server only), then the owner's own session adds the staff
 * row and its audit entry. If that fails, the new auth user is removed again so the email can be
 * invited later.
 */
export async function inviteStaff(
  deps: { db: Db; admin: Db },
  input: InviteStaffInput & { redirectTo: string },
): Promise<StaffResult> {
  // The role check before the invite: otherwise an admin could make Auth send emails.
  const { data: role } = await deps.db.rpc("current_staff_role");
  if (role !== "owner") return { ok: false, error: "forbidden" };

  const { data, error } = await deps.admin.auth.admin.inviteUserByEmail(
    input.email,
    { redirectTo: input.redirectTo },
  );
  if (error || !data.user) {
    if (error?.code === "email_exists") {
      return { ok: false, error: "email_taken", fields: ["email"] };
    }
    console.error("staff invite failed", error?.code ?? error?.status);
    return { ok: false, error: "unavailable" };
  }

  const { error: addError } = await deps.db.rpc("add_staff", {
    p_id: data.user.id,
    p_full_name: input.fullName,
    p_role: input.role,
  });
  if (addError) {
    await deps.admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: staffError(addError) };
  }
  return { ok: true };
}

/**
 * Changes an employee's role or access. A deactivated employee loses access with their next
 * request: every policy asks current_staff_role(), which ignores inactive staff. The database
 * refuses to leave the gym without an active owner and an owner changing their own access.
 */
export async function updateStaffAccess(
  db: Db,
  input: StaffAccessInput,
): Promise<StaffResult> {
  const { error } = await db.rpc("update_staff_access", {
    p_staff_id: input.staffId,
    p_role: input.role,
    p_active: input.active,
  });
  return error ? { ok: false, error: staffError(error) } : { ok: true };
}
