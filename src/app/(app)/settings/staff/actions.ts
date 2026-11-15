"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createAdminDb } from "@/db/admin";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import type { StaffField, StaffResult } from "@/features/staff/form-fields";
import { inviteStaffSchema, staffAccessSchema } from "@/features/staff/schema";
import { inviteStaff, updateStaffAccess } from "@/features/staff/service";

const INVITE_FIELDS = new Set<string>(["email", "fullName", "role"]);

function refreshStaff() {
  revalidatePath("/settings/staff");
  // Coach choices on group forms list active staff.
  revalidatePath("/settings");
  revalidatePath("/groups", "layout");
}

/** Owner only. The service_role client is created here, on the server, and never leaves it. */
export async function inviteStaffAction(raw: unknown): Promise<StaffResult> {
  await requireStaff(["owner"]);
  const parsed = inviteStaffSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = new Set<StaffField>();
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && INVITE_FIELDS.has(field))
        fields.add(field as StaffField);
    }
    return { ok: false, error: "invalid", fields: [...fields] };
  }
  const requestHeaders = await headers();
  // Next has already checked that Origin matches Host for this Server Action; Supabase Auth
  // additionally accepts only redirect URLs from its allow list.
  const origin =
    requestHeaders.get("origin") ?? `https://${requestHeaders.get("host")}`;
  const result = await inviteStaff(
    { db: await createServerDb(), admin: createAdminDb() },
    { ...parsed.data, redirectTo: `${origin}/auth/confirm` },
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
