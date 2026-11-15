import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { columnName, toXlsx } from "./xlsx-write";

function parts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, data]) => [
      name,
      strFromU8(data),
    ]),
  );
}

describe("columnName", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("%i -> %s", (index, name) => {
    expect(columnName(index)).toBe(name);
  });
});

describe("toXlsx", () => {
  const book = parts(
    toXlsx({
      sheetName: "Оплаты",
      header: ["Фамилия", "Сумма"],
      rows: [
        ["Ахметов", 15000],
        ["=HYPERLINK(1)", -15000],
        ['a < b & "c"\u0001', null],
      ],
      widths: [16, 10],
    }),
  );
  const sheet = book["xl/worksheets/sheet1.xml"] ?? "";

  it("has the parts Excel needs for one sheet", () => {
    expect(Object.keys(book).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(book["xl/workbook.xml"]).toContain('<sheet name="Оплаты"');
  });

  it("writes the header bold and frozen, text inline and numbers as numbers", () => {
    expect(sheet).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Фамилия</t></is></c>',
    );
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="B2"><v>15000</v></c>');
    expect(sheet).toContain(
      '<col min="1" max="1" width="16" customWidth="1"/>',
    );
  });

  it("never writes a formula and marks formula-like text as quoted text", () => {
    expect(sheet).not.toMatch(/<f[\s>]/);
    expect(sheet).toContain(
      '<c r="A3" s="2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(1)</t></is></c>',
    );
    expect(book["xl/styles.xml"]).toContain('quotePrefix="1"');
    // A negative number is a number, not text that could run.
    expect(sheet).toContain('<c r="B3"><v>-15000</v></c>');
  });

  it("escapes XML and drops characters XML cannot hold; empty cells are left out", () => {
    expect(sheet).toContain("a &lt; b &amp; &quot;c&quot;</t>");
    expect(sheet).not.toContain("\u0001");
    expect(sheet).not.toContain('r="B4"');
  });
});
