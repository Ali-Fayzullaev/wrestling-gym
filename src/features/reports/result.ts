/** Errors an export reports: codes only, never internal details. */
export type ExportError =
  "forbidden" | "rate_limited" | "invalid" | "unavailable";

export type ExportResult<T> =
  { ok: true; data: T } | { ok: false; error: ExportError };

export type PaymentMethod = "cash" | "kaspi" | "transfer";

export type MoneyCount = { amount: number; count: number };

export type MonthReport = {
  /** Payments recorded in the month and not reversed. */
  total: MoneyCount;
  /** Payments recorded in the month and reversed later (not part of `total`). */
  reversed: MoneyCount;
  /** All three methods, in a fixed order, zero when unused. */
  byMethod: (MoneyCount & { method: PaymentMethod })[];
  /** Biggest first; `groupId` null for clients without a group. */
  byGroup: (MoneyCount & { groupId: string | null; name: string | null })[];
  /** Debtors today by active group; `groupId` null for clients without one. */
  debtors: DebtorGroup[];
};

export type DebtorGroup = {
  groupId: string | null;
  name: string | null;
  /** Monthly price of the group; null without a group. */
  price: number | null;
  count: number;
  /** price x count; 0 without a group. */
  expected: number;
  clients: { id: string; name: string; endsOn: string | null }[];
};

export type ExportFile = {
  fileName: string;
  contentType: string;
  body: Uint8Array<ArrayBuffer>;
};
