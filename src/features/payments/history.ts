// Payment history of the client card: each payment with the reversal that cancelled it, if any,
// and which of the two actions the signed-in employee may take on it. Shown in the card; the
// database enforces the same rules (RLS and insert_reversal()).

import type { Actor } from "@/features/auth/roles";

import {
  CANCEL_WINDOW_MS,
  type PaymentKind,
  type PaymentMethod,
} from "./form-fields";

export type HistoryRow = {
  id: string;
  kind: PaymentKind;
  amount: number;
  /** null only for an opening balance from the import: no money changed hands. */
  method: PaymentMethod | null;
  periodStart: string;
  periodEnd: string;
  reversesId: string | null;
  reason: string | null;
  /** ISO timestamp. */
  createdAt: string;
  createdBy: string;
  createdByName: string;
};

export type HistoryEntry = {
  payment: HistoryRow;
  /** The reversal that cancelled this payment, shown with it rather than as a separate line. */
  reversal: HistoryRow | null;
};

/**
 * Payments and opening balances newest first, each with its reversal. Rows come from
 * client_screen().
 */
export function buildHistory(rows: readonly HistoryRow[]): HistoryEntry[] {
  const reversals = new Map<string, HistoryRow>();
  for (const row of rows)
    if (row.kind === "reversal" && row.reversesId)
      reversals.set(row.reversesId, row);
  return rows
    .filter((row) => row.kind !== "reversal")
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((payment) => ({
      payment,
      reversal: reversals.get(payment.id) ?? null,
    }));
}

/** One-tap "Cancel": not yet reversed, own payment (or the owner), within 10 minutes. */
export function canCancel(entry: HistoryEntry, actor: Actor, now: Date) {
  if (entry.payment.kind !== "payment" || entry.reversal) return false;
  if (entry.payment.createdBy !== actor.id && actor.role !== "owner")
    return false;
  return now.getTime() - Date.parse(entry.payment.createdAt) < CANCEL_WINDOW_MS;
}

/**
 * Reversal with a reason: the owner only, once per payment. An opening balance has no money to
 * reverse; a newer payment supersedes it.
 */
export function canReverse(entry: HistoryEntry, actor: Actor) {
  return (
    entry.payment.kind === "payment" &&
    actor.role === "owner" &&
    entry.reversal === null
  );
}
