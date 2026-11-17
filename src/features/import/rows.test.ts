import { describe, expect, it } from "vitest";

import { matchHeaders } from "./columns";
import type { Table } from "./file";
import { buildPreview, countRows, unknownGroups } from "./rows";

const HEADERS = ["Фамилия", "Имя", "Телефон", "Группа", "Дата окончания"];
const GROUP_ID = "10000000-0000-4000-8000-000000000001";

function table(rows: (string | number | null)[][]): Table {
  return {
    headers: HEADERS,
    rows: rows.map((cells, i) => ({ line: i + 2, cells })),
  };
}

const context = {
  existing: [
    { phone: "+77019990001", lastName: "Старый", firstName: "Клиент" },
  ],
  groups: [{ id: GROUP_ID, name: "Взрослые  Вечер" }],
};

describe("buildPreview", () => {
  const rows = buildPreview(
    table([
      ["  Ёлкин ", "Пётр", "8 701 999 00 02", "взрослые вечер", "18.11.2025"],
      ["старый", "КЛИЕНТ", "+7 701 999 00 01", "", ""],
      ["Ёлкин", "пётр", "87019990002", "", 45979],
      ["", "Без", "87019990003", "", ""],
      ["Номер", "Плохой", "12345", "", "31.02.2026"],
      ["Без", "Телефона", "", "Новички", ""],
      ["Новая", "Группа", "87019990004", "Новички", ""],
    ]),
    matchHeaders(HEADERS),
    context,
  );

  it("normalises a new row and matches its group case-insensitively", () => {
    expect(rows[0]).toEqual({
      line: 2,
      lastName: "Ёлкин",
      firstName: "Пётр",
      phone: "+77019990002",
      groupName: "взрослые вечер",
      groupId: GROUP_ID,
      endsOn: "2025-11-18",
      messageLocale: "ru",
      status: "new",
      errors: [],
      duplicateOf: null,
    });
  });

  it("marks a client already on file and a repeat within the file as duplicates", () => {
    expect(rows[1]).toMatchObject({ status: "duplicate", duplicateOf: null });
    expect(rows[2]).toMatchObject({ status: "duplicate", duplicateOf: 2 });
  });

  it("lists every error of a row", () => {
    expect(rows[3]).toMatchObject({
      status: "error",
      errors: ["last_name_missing"],
    });
    expect(rows[4]).toMatchObject({
      status: "error",
      phone: "12345",
      errors: ["phone_invalid", "date_invalid"],
    });
    expect(rows[5]).toMatchObject({
      status: "error",
      errors: ["phone_missing"],
    });
  });

  it("counts rows by status and lists unknown groups of new rows only", () => {
    expect(countRows(rows)).toEqual({ new: 2, duplicate: 2, error: 3 });
    expect(unknownGroups(rows)).toEqual(["Новички"]);
  });

  it("refuses names longer than the database allows", () => {
    const [row] = buildPreview(
      table([["Ф".repeat(101), "Имя", "87019990005", "", ""]]),
      matchHeaders(HEADERS),
      context,
    );
    expect(row).toMatchObject({ status: "error", errors: ["name_too_long"] });
  });
});

describe("buildPreview: message language column", () => {
  const headers = [...HEADERS, "Язык"];
  const rows = buildPreview(
    {
      headers,
      rows: [
        ["Сериков", "Әлихан", "87019990011", "", "", "қазақша"],
        ["Каримов", "Жасур", "87019990012", "", "", "uz"],
        ["Иванов", "Пётр", "87019990013", "", "", ""],
        ["Плохой", "Язык", "87019990014", "", "", "английский"],
      ].map((cells, i) => ({ line: i + 2, cells })),
    },
    matchHeaders(headers),
    context,
  );

  it("sets the language of each row; an empty cell means Russian", () => {
    expect(rows.map((row) => row.messageLocale)).toEqual([
      "kk",
      "uz",
      "ru",
      "ru",
    ]);
    expect(rows.slice(0, 3).map((row) => row.status)).toEqual([
      "new",
      "new",
      "new",
    ]);
  });

  it("makes an unknown language a row error in the preview", () => {
    expect(rows[3]).toMatchObject({
      status: "error",
      errors: ["locale_invalid"],
    });
  });

  it("reads every row as Russian without the column", () => {
    const [row] = buildPreview(
      table([["Сериков", "Әлихан", "87019990011", "", ""]]),
      matchHeaders(HEADERS),
      context,
    );
    expect(row).toMatchObject({ status: "new", messageLocale: "ru" });
  });
});
