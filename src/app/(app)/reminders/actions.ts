"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import type {
  MarkedReminder,
  OpenedReminder,
  ReminderResult,
} from "@/features/reminders/result";
import {
  markReminderSentSchema,
  openReminderSchema,
} from "@/features/reminders/schema";
import { markReminderSent, openReminder } from "@/features/reminders/service";

function refreshAfterReminder() {
  // "Remind today" and its counter, the Reminders tabs and the reminder history on the card.
  revalidatePath("/today");
  revalidatePath("/reminders");
  revalidatePath("/clients", "layout");
}

// Order in every action: session and role, then Zod, then the service, then revalidation.

/** "Chat opened": called right after the wa.me link opened; repeats are harmless. */
export async function openReminderAction(
  raw: unknown,
): Promise<ReminderResult<OpenedReminder>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = openReminderSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await openReminder(await createServerDb(), actor, parsed.data);
  if (result.ok) refreshAfterReminder();
  return result;
}

export async function markReminderSentAction(
  raw: unknown,
): Promise<ReminderResult<MarkedReminder>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = markReminderSentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await markReminderSent(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (result.ok) refreshAfterReminder();
  return result;
}
