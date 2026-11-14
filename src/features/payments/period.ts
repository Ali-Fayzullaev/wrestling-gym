// Subscription period of a new payment. The database computes the period it stores with the same
// rule (next_period() in supabase/migrations/*_payments_management.sql); this copy shows the
// preview in the payment form, and an integration test keeps the two in step.
// STUB(D-03): until the customer decides, a subscription that is still valid on the payment day
// is extended from its end; an expired one (or the first payment) starts on the payment day.

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
  const start =
    currentEndsOn !== null && currentEndsOn >= paidOn
      ? toIso(addDays(toUtc(currentEndsOn), 1))
      : toIso(toUtc(paidOn));
  return { start, end: periodEnd(start, months) };
}
