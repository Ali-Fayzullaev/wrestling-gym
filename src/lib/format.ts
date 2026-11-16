import { BUSINESS_TIME_ZONE, businessDate } from "./dates";
import type { Locale } from "./locale";

const NBSP = " ";
const CURRENCY = "₸";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Month and weekday names and word order from CLDR, the data behind Intl. Kept here instead of
 * calling Intl at runtime: Chrome ships without Kazakh locale data ("M11 18" instead of
 * "18 қараша") and browsers disagree on Uzbek word order, so a date formatted on the server would
 * not match the same date formatted in the browser. format.test.ts checks these against Node's
 * full ICU.
 */
type CalendarWords = {
  /** "18 ноября": the month as it follows a day number. */
  monthsFormat: readonly string[];
  /** "Ноябрь 2026 г.": the month on its own. */
  monthsStandalone: readonly string[];
  /** Sunday first, as Date.getUTCDay() counts. */
  weekdays: readonly string[];
  dayMonth: string;
  dayMonthYear: string;
  weekdayDayMonth: string;
  monthYear: string;
  /** Digit group separator of whole tenge. */
  group: string;
};

const KK_MONTHS = [
  "қаңтар",
  "ақпан",
  "наурыз",
  "сәуір",
  "мамыр",
  "маусым",
  "шілде",
  "тамыз",
  "қыркүйек",
  "қазан",
  "қараша",
  "желтоқсан",
] as const;

const UZ_MONTHS = [
  "январ",
  "феврал",
  "март",
  "апрел",
  "май",
  "июн",
  "июл",
  "август",
  "сентябр",
  "октябр",
  "ноябр",
  "декабр",
] as const;

const CALENDAR: Record<Locale, CalendarWords> = {
  ru: {
    monthsFormat: [
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
    ],
    monthsStandalone: [
      "январь",
      "февраль",
      "март",
      "апрель",
      "май",
      "июнь",
      "июль",
      "август",
      "сентябрь",
      "октябрь",
      "ноябрь",
      "декабрь",
    ],
    weekdays: [
      "воскресенье",
      "понедельник",
      "вторник",
      "среда",
      "четверг",
      "пятница",
      "суббота",
    ],
    dayMonth: "{d} {M}",
    dayMonthYear: "{d} {M} {y} г.",
    weekdayDayMonth: "{E}, {d}\u00a0{M}",
    monthYear: "{L} {y} г.",
    group: NBSP,
  },
  kk: {
    monthsFormat: KK_MONTHS,
    monthsStandalone: KK_MONTHS,
    weekdays: [
      "жексенбі",
      "дүйсенбі",
      "сейсенбі",
      "сәрсенбі",
      "бейсенбі",
      "жұма",
      "сенбі",
    ],
    dayMonth: "{d} {M}",
    dayMonthYear: "{y} ж. {d} {M}",
    weekdayDayMonth: "{d}\u00a0{M}, {E}",
    monthYear: "{y} ж. {L}",
    group: NBSP,
  },
  uz: {
    monthsFormat: UZ_MONTHS,
    monthsStandalone: UZ_MONTHS,
    weekdays: [
      "якшанба",
      "душанба",
      "сешанба",
      "чоршанба",
      "пайшанба",
      "жума",
      "шанба",
    ],
    dayMonth: "{d} {M}",
    dayMonthYear: "{d} {M}, {y}",
    // CLDR versions disagree here ("ноябр 18, чоршанба" in Node 24, "чоршанба, 18 ноябр" in
    // Chrome); the second reads naturally and matches the Russian layout.
    weekdayDayMonth: "{E}, {d}\u00a0{M}",
    monthYear: "{L}, {y}",
    group: NBSP,
  },
};

type DateParts = { y: number; m: number; d: number };

function render(pattern: string, locale: Locale, parts: DateParts): string {
  const words = CALENDAR[locale];
  const weekday = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
  return pattern.replace(/\{([dMLyE])\}/g, (_, token: string) => {
    switch (token) {
      case "d":
        return String(parts.d);
      case "M":
        return words.monthsFormat[parts.m - 1] ?? "";
      case "L":
        return words.monthsStandalone[parts.m - 1] ?? "";
      case "y":
        return String(parts.y);
      default:
        return words.weekdays[weekday] ?? "";
    }
  });
}

/** Spaces inside a short date never break: "18 ноября" stays on one line. */
function keepTogether(text: string): string {
  return text.replaceAll(" ", NBSP);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Whole tenge with non-breaking spaces, so "25 000 ₸" never wraps: `formatMoney(25000, "ru")`.
 * Amounts are integers in the database; anything else is a bug upstream.
 */
export function formatMoney(amount: number, locale: Locale): string {
  return `${formatAmount(amount, locale)}${NBSP}${CURRENCY}`;
}

/** Whole tenge without the currency sign, for texts that spell it out. */
export function formatAmount(amount: number, locale: Locale): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("formatMoney expects whole tenge");
  }
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, CALENDAR[locale].group);
  // U+2212 minus: same width as digits, so reversal amounts line up in tabular columns.
  const sign = amount < 0 ? "−" : "";
  return `${sign}${digits}`;
}

/**
 * "18 ноября", or with the year when it differs from today's ("18 ноября 2025 г.", "2025 ж. 18
 * қараша"), in Asia/Almaty and the interface language. Accepts an instant or a calendar date from
 * a `date` column ("2026-11-18"), which is taken as is.
 */
export function formatDate(
  date: Date | string,
  today: Date,
  locale: Locale,
): string {
  const parts = calendarParts(date);
  const { y: currentYear } = calendarParts(today);
  const words = CALENDAR[locale];
  const pattern = parts.y === currentYear ? words.dayMonth : words.dayMonthYear;
  return keepTogether(render(pattern, locale, parts));
}

/** "Среда, 18 ноября": the weekday and date of an instant in Asia/Almaty, for screen greetings. */
export function formatWeekdayDate(now: Date, locale: Locale): string {
  const text = render(
    CALENDAR[locale].weekdayDayMonth,
    locale,
    calendarParts(now),
  );
  // Day and month stay together; a long weekday may still wrap on a narrow phone.
  return capitalize(text);
}

/** "Ноябрь 2026 г." of a report month "2026-11", in the interface language. */
export function formatMonth(month: string, locale: Locale): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return capitalize(render(CALENDAR[locale].monthYear, locale, { y, m, d: 1 }));
}

/** "14:32" in Asia/Almaty: 24-hour time reads the same in all three languages. */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

function calendarParts(date: Date | string): DateParts {
  const iso = typeof date === "string" ? date : businessDate(date);
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError("formatDate expects YYYY-MM-DD or a Date");
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}
