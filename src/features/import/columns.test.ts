import { describe, expect, it } from "vitest";

import {
  columnForHeader,
  matchHeaders,
  missingColumns,
  normalizeHeader,
} from "./columns";

describe("normalizeHeader", () => {
  it("ignores case, ё, punctuation and extra spaces", () => {
    expect(normalizeHeader("  Дата  окончания: ")).toBe("дата окончания");
    expect(normalizeHeader("Ёлка")).toBe("елка");
  });
});

describe("columnForHeader", () => {
  it.each([
    ["Фамилия", "lastName"],
    ["ФАМИЛИЯ", "lastName"],
    ["Surname", "lastName"],
    ["Last name", "lastName"],
    ["Тегі", "lastName"],
    ["Имя", "firstName"],
    ["First Name", "firstName"],
    ["Аты", "firstName"],
    ["Телефон", "phone"],
    ["Тел.", "phone"],
    ["Номер телефона", "phone"],
    ["Phone", "phone"],
    ["Телефон нөмірі", "phone"],
    ["Телефон (мамы)", "phone"],
    ["Группа", "group"],
    ["Group", "group"],
    ["Топ", "group"],
    ["Дата окончания", "endsOn"],
    ["Оплачено до", "endsOn"],
    ["Абонемент до", "endsOn"],
    ["End date", "endsOn"],
    ["Аяқталу күні", "endsOn"],
  ])("%j is %s", (header, key) => {
    expect(columnForHeader(header)).toBe(key);
  });

  it.each(["", "Примечание", "Подпись", "+"])("%j is not a field", (header) => {
    expect(columnForHeader(header)).toBeNull();
  });
});

describe("matchHeaders", () => {
  it("maps each field to its column; the first one naming a field wins", () => {
    const mapping = matchHeaders([
      "№",
      "Тегі",
      "Аты",
      "Телефон",
      "Телефон 2",
      "Топ",
      "Оплачено до",
    ]);
    expect(mapping).toEqual({
      lastName: 1,
      firstName: 2,
      phone: 3,
      group: 5,
      endsOn: 6,
    });
    expect(missingColumns(mapping)).toEqual([]);
  });

  it("reports required fields without a column; group and date are optional", () => {
    const mapping = matchHeaders(["ФИО", "Телефон"]);
    expect(mapping.phone).toBe(1);
    expect(missingColumns(mapping)).toEqual(["lastName", "firstName"]);
  });
});
