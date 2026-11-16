import { describe, expect, it } from "vitest";

import { fmt, placeholders, plural } from "./format";
import { kk } from "./kk";
import { ru } from "./ru";
import { uz } from "./uz";

describe("fmt", () => {
  it("fills parameters by name", () => {
    expect(fmt("Выбрано: {count}", { count: 3 })).toBe("Выбрано: 3");
    expect(fmt("{from} – {to}", { from: "1", to: "2" })).toBe("1 – 2");
  });

  it("leaves unknown names and reminder variables as written", () => {
    expect(fmt("{name} и {missing}", { name: "А" })).toBe("А и {missing}");
    expect(fmt("вместо {название_зала}", {})).toBe("вместо {название_зала}");
  });

  it("lists parameter names, not Cyrillic template variables", () => {
    expect(placeholders("{when}, {by} {имя}")).toEqual(["when", "by"]);
  });
});

describe("plural", () => {
  it.each([
    [1, "Слишком много попыток, попробуйте через 1 минуту."],
    [2, "Слишком много попыток, попробуйте через 2 минуты."],
    [5, "Слишком много попыток, попробуйте через 5 минут."],
    [11, "Слишком много попыток, попробуйте через 11 минут."],
    [15, "Слишком много попыток, попробуйте через 15 минут."],
    [21, "Слишком много попыток, попробуйте через 21 минуту."],
  ])("Russian minutes: %i", (minutes, text) => {
    expect(plural("ru", ru.auth.tooManyAttempts, minutes)).toBe(text);
  });

  it.each([
    [0, "0 оплат"],
    [1, "1 оплата"],
    [3, "3 оплаты"],
    [5, "5 оплат"],
    [11, "11 оплат"],
    [21, "21 оплата"],
    [43, "43 оплаты"],
  ])("Russian payments: %i", (count, text) => {
    expect(plural("ru", ru.reports.total.count, count)).toBe(text);
  });

  it.each([
    [1, "1 человек"],
    [2, "2 человека"],
    [5, "5 человек"],
    [12, "12 человек"],
    [22, "22 человека"],
  ])("Russian people: %i", (count, text) => {
    expect(plural("ru", ru.reports.debtors.count, count)).toBe(text);
  });

  it("Kazakh and Uzbek fill the count into their own forms", () => {
    for (const count of [1, 2, 5, 21]) {
      expect(plural("kk", kk.reports.total.count, count)).toContain(
        String(count),
      );
      expect(plural("uz", uz.reports.total.count, count)).toContain(
        String(count),
      );
    }
  });

  it("falls back to `other` when a form is missing", () => {
    expect(plural("ru", { other: "{count} раз" }, 1)).toBe("1 раз");
  });
});
