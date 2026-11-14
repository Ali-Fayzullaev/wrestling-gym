import { describe, expect, it } from "vitest";

import { buildXlsx, csvText, utf8 } from "../../../tests/support/sheets";

import { cellText, detectFileKind, readTable, toTable } from "./file";
import { MAX_FILE_BYTES, MAX_ROWS } from "./limits";

const CSV = utf8(
  csvText([
    ["Фамилия", "Имя", "Телефон"],
    ["Ёлкин", "Пётр", "87011234567"],
  ]),
);

describe("detectFileKind", () => {
  it("accepts .csv text and .xlsx archives", () => {
    expect(detectFileKind({ name: "clients.csv", bytes: CSV })).toEqual({
      ok: true,
      kind: "csv",
    });
    expect(
      detectFileKind({ name: "Клиенты.XLSX", bytes: buildXlsx([["a"]]) }),
    ).toEqual({
      ok: true,
      kind: "xlsx",
    });
  });

  it("refuses empty and oversized files", () => {
    expect(detectFileKind({ name: "a.csv", bytes: new Uint8Array() })).toEqual({
      ok: false,
      error: "empty",
    });
    const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41);
    expect(detectFileKind({ name: "a.csv", bytes: big })).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("explains that the old .xls format must be saved as .xlsx", () => {
    const ole = Uint8Array.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    expect(detectFileKind({ name: "old.xls", bytes: ole })).toEqual({
      ok: false,
      error: "old_excel",
    });
    expect(detectFileKind({ name: "renamed.csv", bytes: ole })).toEqual({
      ok: false,
      error: "old_excel",
    });
  });

  it("refuses other types by name and by content", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
    ]);
    expect(detectFileKind({ name: "photo.png", bytes: png })).toEqual({
      ok: false,
      error: "unsupported",
    });
    expect(detectFileKind({ name: "photo.csv", bytes: png })).toEqual({
      ok: false,
      error: "unsupported",
    });
    expect(
      detectFileKind({ name: "doc.docx", bytes: buildXlsx([["a"]]) }),
    ).toEqual({
      ok: false,
      error: "unsupported",
    });
    expect(detectFileKind({ name: "notes.pdf", bytes: CSV })).toEqual({
      ok: false,
      error: "unsupported",
    });
  });
});

describe("toTable", () => {
  it("takes the first non-empty row as header and skips empty rows, keeping line numbers", () => {
    const table = toTable([
      [],
      ["", null],
      ["Фамилия", "Имя"],
      ["", " "],
      ["Ёлкин", "Пётр"],
    ]);
    expect(table).toEqual({
      headers: ["Фамилия", "Имя"],
      rows: [{ line: 5, cells: ["Ёлкин", "Пётр"] }],
    });
  });

  it("is null for an empty sheet", () => {
    expect(toTable([[], [null]])).toBeNull();
  });
});

describe("cellText", () => {
  it("writes whole numbers without an exponent", () => {
    expect(cellText(87011234567)).toBe("87011234567");
    expect(cellText(1.5)).toBe("1.5");
    expect(cellText(null)).toBe("");
    expect(cellText("  a ")).toBe("a");
  });
});

describe("readTable", () => {
  it("reads CSV and xlsx into the same table", () => {
    const rows = [
      ["Фамилия", "Имя", "Телефон"],
      ["Ёлкин", "Пётр", "87011234567"],
    ];
    const fromCsv = readTable({ name: "a.csv", bytes: utf8(csvText(rows)) });
    const fromXlsx = readTable({ name: "a.xlsx", bytes: buildXlsx(rows) });
    expect(fromCsv).toEqual(fromXlsx);
    expect(fromCsv.ok && fromCsv.table.rows).toEqual([
      { line: 2, cells: rows[1] },
    ]);
  });

  it("reports a damaged workbook, a file with a header only and too many rows", () => {
    const damaged = buildXlsx([["a"]]).slice(0, 40);
    expect(readTable({ name: "a.xlsx", bytes: damaged })).toEqual({
      ok: false,
      error: "unreadable",
    });
    expect(readTable({ name: "a.csv", bytes: utf8("Фамилия;Имя\n") })).toEqual({
      ok: false,
      error: "no_rows",
    });
    const many = [
      "Фамилия;Имя",
      ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `Ф${i};И`),
    ];
    expect(readTable({ name: "a.csv", bytes: utf8(many.join("\n")) })).toEqual({
      ok: false,
      error: "too_many_rows",
    });
  });
});
