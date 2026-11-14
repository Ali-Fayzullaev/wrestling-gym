// Values shared by the payment form (browser) and the server checks. No Zod here, so the client
// islands that import it stay small.

/** payments.method in the database. */
export const PAYMENT_METHODS = ["cash", "kaspi", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Same bound as record_payment(): a typo of an extra zero or two still fits, nonsense does not. */
export const AMOUNT_MAX = 10_000_000;

/** payments.reason: 1..500 characters. */
export const REASON_MAX = 500;

/** How long the author may cancel a payment with one tap (insert_reversal() checks it too). */
export const CANCEL_WINDOW_MS = 10 * 60 * 1000;

/** STUB(D-02): monthly subscriptions only until the customer names other kinds. */
export const PAYMENT_MONTHS = 1;
