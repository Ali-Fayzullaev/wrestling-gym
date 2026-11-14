"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import type {
  SettingsFieldErrors,
  SettingsResult,
} from "@/features/reminders/result";
import { reminderSettingsSchema } from "@/features/reminders/schema";
import { saveReminderSettings } from "@/features/reminders/service";

/** Which fields Zod refused, by name only: the texts themselves never leave the server here. */
function fieldErrors(
  issues: { path: PropertyKey[] }[],
  raw: unknown,
): SettingsFieldErrors {
  const fields: SettingsFieldErrors = {};
  const templates = new Set<string>();
  for (const issue of issues) {
    const [field, index] = issue.path;
    if (field === "firstDays") fields.firstDays = true;
    if (field === "secondDays") fields.secondDays = true;
    if (field === "templates" && typeof index === "number") {
      const id = templateIdAt(raw, index);
      if (id) templates.add(id);
    }
  }
  if (templates.size > 0) fields.templates = [...templates];
  return fields;
}

function templateIdAt(raw: unknown, index: number): string | null {
  if (typeof raw !== "object" || raw === null || !("templates" in raw)) {
    return null;
  }
  const list = raw.templates;
  if (!Array.isArray(list)) return null;
  const item: unknown = list[index];
  if (typeof item !== "object" || item === null || !("id" in item)) return null;
  return typeof item.id === "string" ? item.id : null;
}

/** Owner only; requireStaff sends an admin to the 403 page before anything else runs. */
export async function saveReminderSettingsAction(
  raw: unknown,
): Promise<SettingsResult> {
  const actor = await requireStaff(["owner"]);
  const parsed = reminderSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: fieldErrors(parsed.error.issues, raw),
    };
  }
  const result = await saveReminderSettings(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (result.ok) {
    // Days change who is due today; texts change the links on both reminder screens.
    revalidatePath("/today");
    revalidatePath("/reminders");
    revalidatePath("/settings/reminders");
  }
  return result;
}
