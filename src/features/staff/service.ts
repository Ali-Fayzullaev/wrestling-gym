import { z } from "zod";

import type { Db } from "@/db/client";
import { STAFF_ROLES, type StaffRole } from "@/features/auth/roles";

import type { StaffError, StaffResult } from "./form-fields";
import type {
  AddStaffInput,
  ResetStaffPasswordInput,
  StaffAccessInput,
} from "./schema";

export type StaffMember = {
  id: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
  email: string;
  /** Still has the owner's temporary password: no access until they set their own. */
  mustChangePassword: boolean;
};

// Shape of staff_screen() (supabase/migrations/*_audit_settings_staff.sql).
const staffShape = z.array(
  z.object({
    id: z.string(),
    full_name: z.string(),
    role: z.enum(STAFF_ROLES),
    active: z.boolean(),
    email: z.string(),
    must_change_password: z.boolean(),
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
    mustChangePassword: row.must_change_password,
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

/** Auth refuses a password it considers too easy (length or a known leaked one). */
function isWeakPassword(error: { code?: string }): boolean {
  return error.code === "weak_password";
}

/**
 * Adds an employee with the owner's temporary password (D-14, no email): Supabase Auth creates
 * the user, already confirmed (`admin` is the service_role client, server only), then the owner's
 * own session adds the staff row, locked until the employee sets their own password, and its audit
 * entry. If that fails, the new auth user is removed again so the email can be added later.
 * The password goes to Auth only: never to the database, the log or the answer.
 */
export async function addStaff(
  deps: { db: Db; admin: Db },
  input: AddStaffInput,
): Promise<StaffResult> {
  // The role check before Auth: otherwise an admin could create sign-in accounts.
  const { data: role } = await deps.db.rpc("current_staff_role");
  if (role !== "owner") return { ok: false, error: "forbidden" };

  const { data, error } = await deps.admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user) {
    if (error?.code === "email_exists") {
      return { ok: false, error: "email_taken", fields: ["email"] };
    }
    if (error && isWeakPassword(error)) {
      return { ok: false, error: "weak_password", fields: ["password"] };
    }
    console.error("staff create failed", error?.code ?? error?.status);
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
 * Gives an employee a new temporary password. The database first locks the account until they
 * set their own, ends their open sessions and records the reset (owner only, not for oneself);
 * only then does Auth get the new password. The password itself is never recorded.
 */
export async function resetStaffPassword(
  deps: { db: Db; admin: Db },
  input: ResetStaffPasswordInput,
): Promise<StaffResult> {
  const { error: beginError } = await deps.db.rpc("begin_password_reset", {
    p_staff_id: input.staffId,
  });
  if (beginError) return { ok: false, error: staffError(beginError) };

  const { error } = await deps.admin.auth.admin.updateUserById(input.staffId, {
    password: input.password,
  });
  if (error) {
    if (isWeakPassword(error)) {
      return { ok: false, error: "weak_password", fields: ["password"] };
    }
    console.error("staff password reset failed", error.code ?? error.status);
    return { ok: false, error: "unavailable" };
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
