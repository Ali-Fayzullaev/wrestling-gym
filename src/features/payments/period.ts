// Subscription period of a new payment. The database computes the period it stores with the same
// rule (next_period() and period_end_bounds() in supabase/migrations/*_payment_period.sql); this
// copy fills the payment form, and an integration test keeps the two in step.
// D-03 (2026-11-17): renewal continues from the old end, so paying late gives no free days; only a
// client who paid after the following month would have ended starts again on the payment day.

export type Period = {
  /** YYYY-MM-DD, first day of the subscription. */
  start: string;
  /** YYYY-MM-DD, last day it is valid (inclusive). */
  end: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): Date {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError("expected YYYY-MM-DD");
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

const toIso = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * Last day of a period of `months` starting on `start`: the day before the same day number
 * `months` later. When that day does not exist (31 January + 1 month), the period runs to the end
 * of the shorter month, so 31 January gives 28 (or 29) February, not 27 February.
 */
export function periodEnd(start: string, months: number): string {
  const from = toUtc(start);
  const monthIndex = from.getUTCMonth() + months;
  const year = from.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = daysInMonth(year, month);
  const day = from.getUTCDate();
  if (day > lastDay) return toIso(new Date(Date.UTC(year, month, lastDay)));
  return toIso(addDays(new Date(Date.UTC(year, month, day)), -1));
}

/** Period of a payment made on `paidOn` given the current subscription's end (null: none yet). */
export function nextPeriod(
  currentEndsOn: string | null,
  paidOn: string,
  months = 1,
): Period {
  if (!Number.isInteger(months) || months < 1 || months > 12)
    throw new RangeError("months must be 1..12");
  const paid = toIso(toUtc(paidOn));
  const continued =
    currentEndsOn === null ? null : toIso(addDays(toUtc(currentEndsOn), 1));
  // Valid now, or paid within the month after the old end: continue from the old end.
  const start =
    continued !== null && paid <= periodEnd(continued, 1) ? continued : paid;
  return { start, end: periodEnd(start, months) };
}

export type EndBounds = { min: string; max: string };

/**
 * Last days the person recording a payment may choose instead of the default one.
 * STUB(D-16): proposed by the developer, the customer may change them. Not before the payment day
 * (the client would be in debt again at once) nor before the start, at most 12 months from the
 * start. The database checks the same bounds (period_end_bounds()).
 */
export function periodEndBounds(start: string, paidOn: string): EndBounds {
  return {
    min: start > paidOn ? start : paidOn,
    max: periodEnd(start, 12),
  };
}

/** Whether `end` (YYYY-MM-DD) is a date inside the bounds. */
export function isEndInBounds(end: string, bounds: EndBounds): boolean {
  return ISO_DATE.test(end) && end >= bounds.min && end <= bounds.max;
}
