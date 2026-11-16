"use server";

import { revalidatePath } from "next/cache";

import { createAdminDb } from "@/db/admin";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import type { StaffField, StaffResult } from "@/features/staff/form-fields";
import {
  addStaffSchema,
  resetStaffPasswordSchema,
  staffAccessSchema,
} from "@/features/staff/schema";
import {
  addStaff,
  resetStaffPassword,
  updateStaffAccess,
} from "@/features/staff/service";

const FORM_FIELDS = new Set<string>(["email", "fullName", "role", "password"]);

function refreshStaff() {
  revalidatePath("/settings/staff");
  // Coach choices on group forms list active staff.
  revalidatePath("/settings");
  revalidatePath("/groups", "layout");
}

/** Field names of a failed parse; the issues themselves may echo the typed password. */
function invalidFields(issues: { path: PropertyKey[] }[]): StaffField[] {
  const fields = new Set<StaffField>();
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && FORM_FIELDS.has(field))
      fields.add(field as StaffField);
  }
  return [...fields];
}

/** Owner only. The service_role client is created here, on the server, and never leaves it. */
export async function addStaffAction(raw: unknown): Promise<StaffResult> {
  await requireStaff(["owner"]);
  const parsed = addStaffSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error.issues),
    };
  }
  const result = await addStaff(
    { db: await createServerDb(), admin: createAdminDb() },
    parsed.data,
  );
  if (result.ok) refreshStaff();
  return result;
}

/** Owner only: a new temporary password for another employee. */
export async function resetStaffPasswordAction(
  raw: unknown,
): Promise<StaffResult> {
  await requireStaff(["owner"]);
  const parsed = resetStaffPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error.issues),
    };
  }
  const result = await resetStaffPassword(
    { db: await createServerDb(), admin: createAdminDb() },
    parsed.data,
  );
  if (result.ok) refreshStaff();
  return result;
}

export async function updateStaffAccessAction(
  raw: unknown,
): Promise<StaffResult> {
  await requireStaff(["owner"]);
  const parsed = staffAccessSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await updateStaffAccess(await createServerDb(), parsed.data);
  if (result.ok) refreshStaff();
  return result;
}
