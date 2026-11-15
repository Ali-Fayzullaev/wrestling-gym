"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import type {
  GymField,
  GymSettingsResult,
} from "@/features/settings/form-fields";
import { gymSettingsSchema } from "@/features/settings/schema";
import { updateGymSettings } from "@/features/settings/service";

const GYM_FIELDS = new Set<string>(["gymName", "gymWhatsapp"]);

/** Owner only: session and role, Zod, the service, then the screens that show the gym's name. */
export async function saveGymSettingsAction(
  raw: unknown,
): Promise<GymSettingsResult> {
  await requireStaff(["owner"]);
  const parsed = gymSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = new Set<GymField>();
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && GYM_FIELDS.has(field))
        fields.add(field as GymField);
    }
    return { ok: false, error: "invalid", fields: [...fields] };
  }
  const result = await updateGymSettings(await createServerDb(), parsed.data);
  if (result.ok && result.changed) {
    // The name goes into every reminder text and its preview.
    revalidatePath("/settings");
    revalidatePath("/settings/reminders");
    revalidatePath("/reminders");
    revalidatePath("/today");
  }
  return result;
}
