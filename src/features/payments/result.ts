/** Errors a payment action can report to the screen: codes only, never internal details. */
export type PaymentError =
  | "forbidden"
  | "client_not_found"
  | "payment_not_found"
  | "already_reversed"
  | "cancel_window_passed"
  | "idempotency_conflict"
  | "period_end_out_of_range"
  | "invalid"
  | "unavailable";

export type PaymentResult<T> =
  { ok: true; data: T } | { ok: false; error: PaymentError };

/** What record_payment(), reverse_payment() and cancel_recent_payment() return. */
export type RecordedPayment = {
  id: string;
  clientId: string;
  kind: "payment" | "reversal";
  amount: number;
  periodStart: string;
  periodEnd: string;
  /** false when this was a repeated request and the first one's row came back. */
  created: boolean;
};
