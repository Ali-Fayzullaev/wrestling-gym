import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildXlsx } from "../../../tests/support/sheets";

import { decodeXml, readXlsx, XlsxError } from "./xlsx";

describe("readXlsx", () => {
  it("reads shared strings, inline strings, formula results and numbers of the first sheet", () => {
    const bytes = buildXlsx([
      ["Фамилия", "Имя", "Телефон", "Дата окончания"],
      ["Ёлкин", { inline: "Пётр" }, 87011234567, 45979],
      [{ formula: "Сериков" }, "Арман", "+7 701 123 45 68", "18.11.2025"],
    ]);
    expect(readXlsx(bytes)).toEqual([
      ["Фамилия", "Имя", "Телефон", "Дата окончания"],
      ["Ёлкин", "Пётр", 87011234567, 45979],
      ["Сериков", "Арман", "+7 701 123 45 68", "18.11.2025"],
    ]);
  });

  it("keeps row numbers and column positions when cells or rows are missing", () => {
    const bytes = buildXlsx([["A", null, "C"], [], ["x"]]);
    const rows = readXlsx(bytes);
    expect(rows[0]).toEqual(["A", null, "C"]);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(["x"]);
  });

  it("decodes XML entities in text", () => {
    expect(readXlsx(buildXlsx([['"Дети" & <юниоры>']]))).toEqual([
      ['"Дети" & <юниоры>'],
    ]);
    expect(decodeXml("&#1040;&#x411;&amp;")).toBe("АБ&");
  });

  it("joins rich-text runs and leaves out phonetic hints", () => {
    const sst =
      "<sst><si><r><t>Иван</t></r><r><rPr/><t>ов</t></r><rPh><t>x</t></rPh></si></sst>";
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const bytes = zipSync({
      "xl/sharedStrings.xml": strToU8(sst),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    });
    expect(readXlsx(bytes)).toEqual([["Иванов"]]);
  });

  it("refuses a character reference outside Unicode as an unreadable file, not a crash", () => {
    const sheet =
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&#99999999;</t></is></c></row></sheetData></worksheet>';
    const bytes = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) });
    expect(() => readXlsx(bytes)).toThrow(XlsxError);
  });

  it("refuses a file that is not a zip archive", () => {
    expect(() => readXlsx(strToU8("Фамилия;Имя"))).toThrow(XlsxError);
  });

  it("refuses a workbook without a worksheet", () => {
    const bytes = zipSync({ "docProps/app.xml": strToU8("<x/>") });
    expect(() => readXlsx(bytes)).toThrow(XlsxError);
  });

  it("refuses a part that unpacks to more than the limit (zip bomb)", () => {
    const huge = new Uint8Array(31 * 1024 * 1024).fill(0x20);
    const bytes = zipSync({ "xl/worksheets/sheet1.xml": huge }, { level: 9 });
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => readXlsx(bytes)).toThrow(XlsxError);
  });
});
