"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import type {
  PaymentResult,
  RecordedPayment,
} from "@/features/payments/result";
import {
  cancelPaymentSchema,
  recordPaymentSchema,
  reversePaymentSchema,
} from "@/features/payments/schema";
import {
  cancelRecentPayment,
  recordPayment,
  reversePayment,
} from "@/features/payments/service";

function refreshAfterPayment() {
  // Statuses change on the client list and card, the group and parent screens and the Today
  // counters.
  revalidatePath("/clients", "layout");
  revalidatePath("/groups", "layout");
  revalidatePath("/parents", "layout");
  revalidatePath("/today");
}

// Order in every action: session and role, then Zod, then the service, then revalidation.

export async function recordPaymentAction(
  raw: unknown,
): Promise<PaymentResult<RecordedPayment>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = recordPaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await recordPayment(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (result.ok) refreshAfterPayment();
  return result;
}

export async function cancelPaymentAction(
  raw: unknown,
): Promise<PaymentResult<RecordedPayment>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = cancelPaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await cancelRecentPayment(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (result.ok) refreshAfterPayment();
  return result;
}

/** Owner only; requireStaff sends an admin to the 403 page before anything else runs. */
export async function reversePaymentAction(
  raw: unknown,
): Promise<PaymentResult<RecordedPayment>> {
  const actor = await requireStaff(["owner"]);
  const parsed = reversePaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await reversePayment(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (result.ok) refreshAfterPayment();
  return result;
}
