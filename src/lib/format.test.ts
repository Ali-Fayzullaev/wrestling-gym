import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatDate,
  formatMoney,
  formatMonth,
  formatTime,
  formatWeekdayDate,
} from "./format";

const NBSP = " ";

describe("formatAmount", () => {
  it("groups digits like formatMoney, without the currency sign", () => {
    expect(formatAmount(25000, "ru")).toBe(`25${NBSP}000`);
    expect(formatAmount(-1500, "ru")).toBe(`−1${NBSP}500`);
  });

  it("refuses fractions", () => {
    expect(() => formatAmount(1.5, "ru")).toThrow(RangeError);
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
    expect(formatMoney(amount, "ru")).toBe(text);
  });

  it("refuses fractions and non-numbers", () => {
    expect(() => formatMoney(12.5, "ru")).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, "ru")).toThrow(RangeError);
  });
});

describe("formatDate", () => {
  const today = new Date("2026-11-13T07:00:00Z");

  it("omits the current year", () => {
    expect(formatDate(new Date("2026-11-18T06:00:00Z"), today, "ru")).toBe(
      `18${NBSP}ноября`,
    );
  });

  it("adds another year", () => {
    expect(formatDate(new Date("2025-11-18T06:00:00Z"), today, "ru")).toBe(
      `18${NBSP}ноября${NBSP}2025${NBSP}г.`,
    );
    expect(formatDate("2027-01-05", today, "ru")).toBe(
      `5${NBSP}января${NBSP}2027${NBSP}г.`,
    );
  });

  it("takes the year from Almaty, not UTC, around New Year", () => {
    // 31 Dec 19:30 UTC is already 1 January 00:30 in Almaty.
    const newYearInAlmaty = new Date("2026-12-31T19:30:00Z");
    expect(formatDate(newYearInAlmaty, newYearInAlmaty, "ru")).toBe(
      `1${NBSP}января`,
    );
    expect(
      formatDate(new Date("2026-12-31T12:00:00Z"), newYearInAlmaty, "ru"),
    ).toBe(`31${NBSP}декабря${NBSP}2026${NBSP}г.`);
  });

  it("uses the Almaty day just after midnight", () => {
    // 17 Nov 19:00 UTC = 18 Nov 00:00 in Almaty; 18:59 UTC is still 17 Nov.
    expect(formatDate(new Date("2026-11-17T19:00:00Z"), today, "ru")).toBe(
      `18${NBSP}ноября`,
    );
    expect(formatDate(new Date("2026-11-17T18:59:59Z"), today, "ru")).toBe(
      `17${NBSP}ноября`,
    );
  });

  it("takes a date column value as the calendar date", () => {
    expect(formatDate("2026-02-28", today, "ru")).toBe(`28${NBSP}февраля`);
    expect(() => formatDate("28.02.2026", today, "ru")).toThrow(RangeError);
  });

  it("names every month in the genitive", () => {
    const months = Array.from({ length: 12 }, (_, index) =>
      formatDate(`2026-${String(index + 1).padStart(2, "0")}-01`, today, "ru"),
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
    expect(formatWeekdayDate(new Date("2026-11-18T06:00:00Z"), "ru")).toBe(
      "Среда, 18\u00a0ноября",
    );
  });

  it("switches to the next day at midnight in Almaty, not in UTC", () => {
    // 23:30 and 00:30 local time (UTC+5).
    expect(formatWeekdayDate(new Date("2026-11-17T18:30:00Z"), "ru")).toBe(
      "Вторник, 17\u00a0ноября",
    );
    expect(formatWeekdayDate(new Date("2026-11-17T19:30:00Z"), "ru")).toBe(
      "Среда, 18\u00a0ноября",
    );
  });

  it("keeps day and month together on one line", () => {
    expect(formatWeekdayDate(new Date("2026-01-05T06:00:00Z"), "ru")).toBe(
      "Понедельник, 5\u00a0января",
    );
  });
});

describe("formats by interface language", () => {
  const today = new Date("2026-11-13T07:00:00Z");

  it("dates in Kazakh and Uzbek (Cyrillic)", () => {
    expect(formatDate("2026-11-18", today, "kk")).toBe(`18${NBSP}қараша`);
    expect(formatDate("2026-11-18", today, "uz")).toBe(`18${NBSP}ноябр`);
    expect(formatDate("2025-11-18", today, "kk")).toBe(
      `2025${NBSP}ж.${NBSP}18${NBSP}қараша`,
    );
    expect(formatDate("2025-11-18", today, "uz")).toBe(
      `18${NBSP}ноябр,${NBSP}2025`,
    );
  });

  it("weekday and date on Today", () => {
    const wednesday = new Date("2026-11-18T06:00:00Z");
    expect(formatWeekdayDate(wednesday, "kk")).toBe(
      `18${NBSP}қараша, сәрсенбі`,
    );
    expect(formatWeekdayDate(wednesday, "uz")).toBe(`Чоршанба, 18${NBSP}ноябр`);
  });

  it("report months", () => {
    expect(formatMonth("2026-11", "ru")).toBe("Ноябрь 2026 г.");
    expect(formatMonth("2027-01", "ru")).toBe("Январь 2027 г.");
    expect(formatMonth("2026-11", "kk")).toBe("2026 ж. қараша");
    expect(formatMonth("2026-11", "uz")).toBe("Ноябр, 2026");
  });

  it("amounts group digits the same way in all three", () => {
    for (const locale of ["ru", "kk", "uz"] as const) {
      expect(formatMoney(1234567, locale)).toBe(
        `1${NBSP}234${NBSP}567${NBSP}₸`,
      );
      expect(formatMoney(-25000, locale)).toBe(`−25${NBSP}000${NBSP}₸`);
    }
  });
});

describe("calendar words match CLDR (Node's full ICU)", () => {
  // The browser may lack Kazakh data, so the app formats from its own tables; these must agree
  // with Intl where Intl is complete.
  const INTL = { ru: "ru-KZ", kk: "kk-KZ", uz: "uz-Cyrl-UZ" } as const;
  const today = new Date("2026-06-15T07:00:00Z");
  const intl = (
    locale: keyof typeof INTL,
    options: Intl.DateTimeFormatOptions,
    iso: string,
  ) =>
    new Intl.DateTimeFormat(INTL[locale], { timeZone: "UTC", ...options })
      .format(new Date(`${iso}T12:00:00Z`))
      .replace(/\s/g, NBSP);

  for (const locale of ["ru", "kk", "uz"] as const) {
    it(`${locale}: every month with and without the year`, () => {
      for (let month = 1; month <= 12; month += 1) {
        const mm = String(month).padStart(2, "0");
        expect(formatDate(`2026-${mm}-09`, today, locale)).toBe(
          intl(locale, { day: "numeric", month: "long" }, `2026-${mm}-09`),
        );
        expect(formatDate(`2025-${mm}-09`, today, locale)).toBe(
          intl(
            locale,
            { day: "numeric", month: "long", year: "numeric" },
            `2025-${mm}-09`,
          ),
        );
      }
    });

    it(`${locale}: report months`, () => {
      for (let month = 1; month <= 12; month += 1) {
        const mm = String(month).padStart(2, "0");
        const expected = intl(
          locale,
          { month: "long", year: "numeric" },
          `2026-${mm}-01`,
        );
        expect(formatMonth(`2026-${mm}`, locale).replace(/\s/g, NBSP)).toBe(
          expected.charAt(0).toUpperCase() + expected.slice(1),
        );
      }
    });

    it(`${locale}: digit groups`, () => {
      expect(formatAmount(1234567, locale)).toBe(
        new Intl.NumberFormat(INTL[locale])
          .format(1234567)
          .replace(/\s/g, NBSP),
      );
    });
  }

  it("weekdays of Russian and Kazakh, every day of a week", () => {
    for (let day = 16; day <= 22; day += 1) {
      const instant = new Date(`2026-11-${day}T06:00:00Z`);
      for (const locale of ["ru", "kk"] as const) {
        const expected = intl(
          locale,
          { weekday: "long", day: "numeric", month: "long" },
          `2026-11-${day}`,
        );
        expect(formatWeekdayDate(instant, locale).replace(/\s/g, NBSP)).toBe(
          expected.charAt(0).toUpperCase() + expected.slice(1),
        );
      }
    }
  });
});
