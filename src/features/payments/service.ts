import { z } from "zod";

import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";

import { PAYMENT_MONTHS } from "./form-fields";
import type { PaymentError, PaymentResult, RecordedPayment } from "./result";
import type {
  CancelPaymentInput,
  RecordPaymentInput,
  ReversePaymentInput,
} from "./schema";

// Shape of payment_json() (supabase/migrations/*_payments_management.sql). The database returns
// jsonb, so the reply is checked rather than trusted.
const recordedShape = z.object({
  id: z.string(),
  client_id: z.string(),
  kind: z.enum(["payment", "reversal"]),
  amount: z.number(),
  period_start: z.string(),
  period_end: z.string(),
  created: z.boolean(),
});

function toRecorded(data: unknown): RecordedPayment {
  const row = recordedShape.parse(data);
  return {
    id: row.id,
    clientId: row.client_id,
    kind: row.kind,
    amount: row.amount,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    created: row.created,
  };
}

const MESSAGE_ERRORS: Record<string, PaymentError> = {
  client_not_found: "client_not_found",
  payment_not_found: "payment_not_found",
  already_reversed: "already_reversed",
  cancel_window_passed: "cancel_window_passed",
  idempotency_conflict: "idempotency_conflict",
  period_end_out_of_range: "period_end_out_of_range",
};

/** Postgres errors raised by the payment functions, mapped to what the screen can say. */
export function paymentError(error: {
  code?: string;
  message?: string;
}): PaymentError {
  const known = error.message ? MESSAGE_ERRORS[error.message] : undefined;
  if (known) return known;
  // RLS refusal or the role check inside the functions.
  if (error.code === "42501") return "forbidden";
  // A parallel reversal of the same payment hit payments.reverses_id unique.
  if (error.code === "23505") return "already_reversed";
  if (
    error.code === "22023" ||
    error.code === "23514" ||
    error.code === "22P02"
  )
    return "invalid";
  return "unavailable";
}

const isStaff = (actor: Actor) =>
  actor.role === "owner" || actor.role === "admin";

/**
 * Records a payment and its audit row in one transaction. The period comes from the database
 * (server date, D-03 rule); a last day chosen by hand is checked against the bounds there. Repeating the request with the same key returns the same payment.
 */
export async function recordPayment(
  db: Db,
  actor: Actor,
  input: RecordPaymentInput,
): Promise<PaymentResult<RecordedPayment>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("record_payment", {
    p_client_id: input.clientId,
    p_amount: input.amount,
    p_method: input.method,
    p_idempotency_key: input.idempotencyKey,
    p_months: PAYMENT_MONTHS,
    p_period_end: input.periodEnd,
  });
  if (error) return { ok: false, error: paymentError(error) };
  return { ok: true, data: toRecorded(data) };
}

/** Owner only: a reversal with a reason cancels the payment; the original row stays. */
export async function reversePayment(
  db: Db,
  actor: Actor,
  input: ReversePaymentInput,
): Promise<PaymentResult<RecordedPayment>> {
  if (actor.role !== "owner") return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("reverse_payment", {
    p_payment_id: input.paymentId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { ok: false, error: paymentError(error) };
  return { ok: true, data: toRecorded(data) };
}

/** The author (or the owner) cancels a payment within 10 minutes; the database checks the clock. */
export async function cancelRecentPayment(
  db: Db,
  actor: Actor,
  input: CancelPaymentInput,
): Promise<PaymentResult<RecordedPayment>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("cancel_recent_payment", {
    p_payment_id: input.paymentId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return { ok: false, error: paymentError(error) };
  return { ok: true, data: toRecorded(data) };
}
