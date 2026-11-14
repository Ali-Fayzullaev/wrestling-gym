import { z } from "zod";

import { AMOUNT_MAX, PAYMENT_METHODS, REASON_MAX } from "./form-fields";

const id = z.uuid();

export const recordPaymentSchema = z.object({
  clientId: id,
  amount: z.coerce.number().int().min(1).max(AMOUNT_MAX),
  method: z.enum(PAYMENT_METHODS),
  idempotencyKey: id,
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

export const reversePaymentSchema = z.object({
  paymentId: id,
  reason: z.string().trim().min(1).max(REASON_MAX),
  idempotencyKey: id,
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;

export const cancelPaymentSchema = z.object({
  paymentId: id,
  idempotencyKey: id,
});
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;
