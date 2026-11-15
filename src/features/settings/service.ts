import { z } from "zod";

import type { Db } from "@/db/client";

import type { GymSettings, GymSettingsResult } from "./form-fields";
import type { GymSettingsInput } from "./schema";

const settingsShape = z.object({
  gym_name: z.string(),
  gym_whatsapp: z.string().nullable(),
  reminder_days: z.array(z.number()),
});

export type SettingsOverview = GymSettings & { reminderDays: number[] };

/** The single settings row: every employee may read it (wa.me links need it). */
export async function getSettings(db: Db): Promise<SettingsOverview> {
  const { data, error } = await db
    .from("settings")
    .select("gym_name, gym_whatsapp, reminder_days")
    .single();
  if (error) throw new Error(`settings read failed: ${error.code}`);
  const row = settingsShape.parse(data);
  return {
    gymName: row.gym_name,
    gymWhatsapp: row.gym_whatsapp,
    reminderDays: row.reminder_days,
  };
}

/** Saves the gym's name and number with one audit row (field names only). Owner only. */
export async function updateGymSettings(
  db: Db,
  input: GymSettingsInput,
): Promise<GymSettingsResult> {
  const { data, error } = await db.rpc("update_gym_settings", {
    p_gym_name: input.gymName,
    // An empty string clears the number: the function stores it as null.
    p_gym_whatsapp: input.gymWhatsapp ?? "",
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "forbidden" };
    if (error.code === "23514") return { ok: false, error: "invalid" };
    return { ok: false, error: "unavailable" };
  }
  const reply = z.object({ changed: z.boolean() }).parse(data);
  return { ok: true, changed: reply.changed };
}
