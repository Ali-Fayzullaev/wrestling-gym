import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatDate,
  formatMoney,
  formatTime,
  formatWeekdayDate,
} from "./format";

const NBSP = " ";

describe("formatAmount", () => {
  it("groups digits like formatMoney, without the currency sign", () => {
    expect(formatAmount(25000)).toBe(`25${NBSP}000`);
    expect(formatAmount(-1500)).toBe(`−1${NBSP}500`);
  });

  it("refuses fractions", () => {
    expect(() => formatAmount(1.5)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it.each([
    [25000, `25${NBSP}000${NBSP}₸`],
    [0, `0${NBSP}₸`],
    [500, `500${NBSP}₸`],
    [1000, `1${NBSP}000${NBSP}₸`],
    [1234567, `1${NBSP}234${NBSP}567${NBSP}₸`],
    [-25000, `−25${NBSP}000${NBSP}₸`],
  ])("%i", (amount, text) => {
    expect(formatMoney(amount)).toBe(text);
  });

  it("refuses fractions and non-numbers", () => {
    expect(() => formatMoney(12.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN)).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  const today = new Date("2026-11-13T07:00:00Z");

  it("omits the current year", () => {
    expect(formatDate(new Date("2026-11-18T06:00:00Z"), today)).toBe(
      `18${NBSP}ноября`,
    );
  });

  it("adds another year", () => {
    expect(formatDate(new Date("2025-11-18T06:00:00Z"), today)).toBe(
      `18${NBSP}ноября 2025`,
    );
    expect(formatDate("2027-01-05", today)).toBe(`5${NBSP}января 2027`);
  });

  it("takes the year from Almaty, not UTC, around New Year", () => {
    // 31 Dec 19:30 UTC is already 1 January 00:30 in Almaty.
    const newYearInAlmaty = new Date("2026-12-31T19:30:00Z");
    expect(formatDate(newYearInAlmaty, newYearInAlmaty)).toBe(`1${NBSP}января`);
    expect(formatDate(new Date("2026-12-31T12:00:00Z"), newYearInAlmaty)).toBe(
      `31${NBSP}декабря 2026`,
    );
  });

  it("uses the Almaty day just after midnight", () => {
    // 17 Nov 19:00 UTC = 18 Nov 00:00 in Almaty; 18:59 UTC is still 17 Nov.
    expect(formatDate(new Date("2026-11-17T19:00:00Z"), today)).toBe(
      `18${NBSP}ноября`,
    );
    expect(formatDate(new Date("2026-11-17T18:59:59Z"), today)).toBe(
      `17${NBSP}ноября`,
    );
  });

  it("takes a date column value as the calendar date", () => {
    expect(formatDate("2026-02-28", today)).toBe(`28${NBSP}февраля`);
    expect(() => formatDate("28.02.2026", today)).toThrow(RangeError);
  });

  it("names every month in the genitive", () => {
    const months = Array.from({ length: 12 }, (_, index) =>
      formatDate(`2026-${String(index + 1).padStart(2, "0")}-01`, today),
    );
    expect(months.map((text) => text.split(NBSP)[1])).toEqual([
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
    ]);
  });
});

describe("formatTime", () => {
  it("shows 24-hour Almaty time", () => {
    expect(formatTime(new Date("2026-11-18T09:32:00Z"))).toBe("14:32");
    expect(formatTime(new Date("2026-11-17T19:05:00Z"))).toBe("00:05");
  });
});

describe("formatWeekdayDate", () => {
  it("names the weekday and date in Almaty", () => {
    // 18 November 2026 is a Wednesday.
    expect(formatWeekdayDate(new Date("2026-11-18T06:00:00Z"))).toBe(
      "Среда, 18\u00a0ноября",
    );
  });

  it("switches to the next day at midnight in Almaty, not in UTC", () => {
    // 23:30 and 00:30 local time (UTC+5).
    expect(formatWeekdayDate(new Date("2026-11-17T18:30:00Z"))).toBe(
      "Вторник, 17\u00a0ноября",
    );
    expect(formatWeekdayDate(new Date("2026-11-17T19:30:00Z"))).toBe(
      "Среда, 18\u00a0ноября",
    );
  });

  it("keeps day and month together on one line", () => {
    expect(formatWeekdayDate(new Date("2026-01-05T06:00:00Z"))).toBe(
      "Понедельник, 5\u00a0января",
    );
  });
});
