import { describe, expect, it } from "vitest";

import {
  type ReminderContact,
  reminderValues,
  renderTemplate,
  type TemplateValues,
  unknownVariables,
} from "./template";

const NBSP = "\u00a0";
const TODAY = new Date("2026-11-14T06:00:00Z");

const VALUES: TemplateValues = {
  имя: "Азамат",
  дата_окончания: `15${NBSP}ноября`,
  сумма: `15${NBSP}000`,
  группа: "Дети 6–9 лет",
  название_зала: "Зал греко-римской борьбы",
};

const ADULT: ReminderContact = {
  firstName: "Азамат",
  phoneOwner: "self",
  parentName: null,
  groupName: "Взрослые",
  price: 20000,
  endsOn: "2026-11-15",
};

describe("renderTemplate", () => {
  it("fills every variable", () => {
    expect(
      renderTemplate(
        "Здравствуйте, {имя}! {название_зала}, группа «{группа}»: до {дата_окончания}, {сумма} тенге.",
        VALUES,
      ),
    ).toBe(
      `Здравствуйте, Азамат! Зал греко-римской борьбы, группа «Дети 6–9 лет»: до 15${NBSP}ноября, 15${NBSP}000 тенге.`,
    );
  });

  it("fills a variable used twice", () => {
    expect(renderTemplate("{имя}, {имя}", VALUES)).toBe("Азамат, Азамат");
  });

  it("leaves an unknown variable exactly as written", () => {
    expect(
      renderTemplate("Привет, {имя}! {телефон} {Имя} { имя }", VALUES),
    ).toBe("Привет, Азамат! {телефон} {Имя} { имя }");
  });

  it("drops a missing amount without leaving double spaces or a space before punctuation", () => {
    const text = renderTemplate(
      "Сумма продления: {сумма} тенге. Группа {группа}, ждём!",
      {
        ...VALUES,
        сумма: null,
        группа: null,
      },
    );
    expect(text).toBe("Сумма продления: тенге. Группа, ждём!");
    expect(text).not.toMatch(/ {2}| [,.!?:;]|\{/);
  });

  it("keeps line breaks, trims each line and squeezes blank lines", () => {
    expect(
      renderTemplate(
        "  {имя},\r\n\r\n\r\n\r\n  до   {дата_окончания}  ",
        VALUES,
      ),
    ).toBe(`Азамат,\n\nдо 15${NBSP}ноября`);
  });
});

describe("unknownVariables", () => {
  it("lists unknown tokens once, in order", () => {
    expect(unknownVariables("{имя} {телефон} {сумма} {телефон} {}")).toEqual([
      "{телефон}",
      "{}",
    ]);
  });

  it("is empty for a template with known variables only", () => {
    expect(
      unknownVariables(
        "{имя} {дата_окончания} {сумма} {группа} {название_зала}",
      ),
    ).toEqual([]);
  });
});

describe("reminderValues", () => {
  it("greets an adult by first name and formats the date and amount", () => {
    expect(reminderValues(ADULT, "Зал", TODAY)).toEqual({
      имя: "Азамат",
      дата_окончания: `15${NBSP}ноября`,
      сумма: `20${NBSP}000`,
      группа: "Взрослые",
      название_зала: "Зал",
    });
  });

  it("greets the parent of a child when the parent's name is known", () => {
    const child = {
      ...ADULT,
      phoneOwner: "parent" as const,
      parentName: "Динара",
    };
    expect(reminderValues(child, "Зал", TODAY).имя).toBe("Динара");
  });

  it("falls back to the child's name without a parent's name", () => {
    const child = { ...ADULT, phoneOwner: "parent" as const, parentName: null };
    expect(reminderValues(child, "Зал", TODAY).имя).toBe("Азамат");
  });

  it("has no amount or group without a group", () => {
    const values = reminderValues(
      { ...ADULT, groupName: null, price: null },
      "Зал",
      TODAY,
    );
    expect(values.сумма).toBeNull();
    expect(values.группа).toBeNull();
  });

  it("adds the year to an end date in another year", () => {
    const values = reminderValues(
      { ...ADULT, endsOn: "2027-01-02" },
      "Зал",
      TODAY,
    );
    expect(values.дата_окончания).toBe(`2${NBSP}января${NBSP}2027${NBSP}г.`);
  });
});
