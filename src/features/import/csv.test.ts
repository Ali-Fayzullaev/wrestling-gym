import { describe, expect, it } from "vitest";

import { csvText, encodeCp1251, utf8 } from "../../../tests/support/sheets";

import { decodeCsv, detectDelimiter, parseCsv } from "./csv";

const ROWS = [
  ["Фамилия", "Имя", "Телефон", "Группа", "Дата окончания"],
  ["Ёлкин", "Пётр", "8 701 123 45 67", "Дети 7–9", "18.11.2025"],
  ["Иванова", "Аружан", "+77011234568", "Взрослые", "01.12.2025"],
];

describe("decodeCsv", () => {
  it("reads UTF-8 with and without a BOM", () => {
    const text = csvText(ROWS);
    expect(decodeCsv(utf8(`﻿${text}`))).toBe(text);
    expect(decodeCsv(utf8(text))).toBe(text);
  });

  it("falls back to Windows-1251 when the bytes are not UTF-8", () => {
    const text = csvText(
      ROWS.map((row) => row.map((f) => f.replace("–", "-"))),
    );
    expect(decodeCsv(encodeCp1251(text))).toBe(text);
  });
});

describe("parseCsv", () => {
  it.each([
    ["semicolon", ";"],
    ["comma", ","],
  ])("splits by %s, detected from the header line", (_name, delimiter) => {
    const text = csvText(ROWS, delimiter);
    expect(detectDelimiter(text)).toBe(delimiter);
    expect(parseCsv(text)).toEqual(ROWS);
  });

  it("parses Windows-1251 with commas end to end", () => {
    const rows = [
      ["Фамилия", "Имя", "Телефон"],
      ["Ёлкин", "Пётр", "87011234567"],
    ];
    const text = decodeCsv(encodeCp1251(csvText(rows, ",")));
    expect(parseCsv(text)).toEqual(rows);
  });

  it("keeps separators, line breaks and doubled quotes inside quoted fields", () => {
    const text = 'a;b;c\n"x;y";"line\nbreak";"say ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x;y", "line\nbreak", 'say "hi"'],
    ]);
  });

  it("handles CRLF, a trailing line without a break and empty fields", () => {
    expect(parseCsv("a;b\r\n;2\r\n3;", ";")).toEqual([
      ["a", "b"],
      ["", "2"],
      ["3", ""],
    ]);
  });

  it("takes a tab-separated export too", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
