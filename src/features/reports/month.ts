import { businessDate } from "@/lib/dates";

// A report month is "YYYY-MM" (the address of the screen and the export carries it; it holds no
// personal data). Months are calendar months in Asia/Almaty.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The earliest month a report is offered for; the database accepts nothing before 2020. */
export const FIRST_MONTH = "2020-01";

/** The month of `now` in Asia/Almaty. */
export function currentMonth(now: Date): string {
  return businessDate(now).slice(0, 7);
}

/** The month `delta` months away: shiftMonth("2026-01", -1) is "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + delta;
  const shiftedYear = Math.floor(index / 12);
  return `${shiftedYear}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * The month asked for, or the current one when it is missing, malformed, in the future or before
 * FIRST_MONTH. Months compare as text because the format is fixed-width.
 */
export function parseMonth(value: unknown, now: Date): string {
  const current = currentMonth(now);
  if (typeof value !== "string" || !MONTH.test(value)) return current;
  if (value > current || value < FIRST_MONTH) return current;
  return value;
}

/** "2026-11" -> "2026-11-01", what the report functions take. */
export function monthStart(month: string): string {
  return `${month}-01`;
}
