import { BUSINESS_TIME_ZONE, businessDate } from "./dates";

const NBSP = " ";
const CURRENCY = "₸";

const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Whole tenge with non-breaking spaces, so "25 000 ₸" never wraps: `formatMoney(25000)`.
 * Amounts are integers in the database; anything else is a bug upstream.
 */
export function formatMoney(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("formatMoney expects whole tenge");
  }
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  // U+2212 minus: same width as digits, so reversal amounts line up in tabular columns.
  const sign = amount < 0 ? "−" : "";
  return `${sign}${digits}${NBSP}${CURRENCY}`;
}

/**
 * "18 ноября", or "18 ноября 2025" when the year differs from today's, both in Asia/Almaty.
 * Accepts an instant or a calendar date from a `date` column ("2026-11-18"), which is taken as is.
 */
export function formatDate(date: Date | string, today: Date): string {
  const [year, month, day] = calendarParts(date);
  const [currentYear] = calendarParts(today);
  const dayMonth = `${day}${NBSP}${MONTHS_GENITIVE[month - 1]}`;
  return year === currentYear ? dayMonth : `${dayMonth} ${year}`;
}

const weekdayFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: "long",
});

/** "Среда, 18 ноября": the weekday and date of an instant in Asia/Almaty, for screen greetings. */
export function formatWeekdayDate(now: Date): string {
  const weekday = weekdayFormatter.format(now);
  const [, month, day] = calendarParts(now);
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${capitalized}, ${day}${NBSP}${MONTHS_GENITIVE[month - 1]}`;
}

/** "14:32" in Asia/Almaty. */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

function calendarParts(date: Date | string): [number, number, number] {
  const iso = typeof date === "string" ? date : businessDate(date);
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError("formatDate expects YYYY-MM-DD or a Date");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
