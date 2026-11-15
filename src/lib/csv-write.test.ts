import { describe, expect, it } from "vitest";

import { looksLikeFormula, neutralizeFormula, toCsv } from "./csv-write";

describe("toCsv", () => {
  it("starts with a BOM, separates by ; and ends lines with CRLF", () => {
    expect(
      toCsv([
        ["Фамилия", "Имя"],
        ["Ёлкин", "Пётр"],
      ]),
    ).toBe("﻿Фамилия;Имя\r\nЁлкин;Пётр");
  });

  it("quotes separators, quotes and line breaks", () => {
    expect(toCsv([["a;b", 'say "hi"', "two\nlines"]])).toBe(
      '﻿"a;b";"say ""hi""";"two\nlines"',
    );
  });

  it("keeps formula-like text from running in Excel, but not phone numbers", () => {
    expect(toCsv([["=HYPERLINK(1)", "@cmd", "+7 701 000 00 00", "-5"]])).toBe(
      "﻿'=HYPERLINK(1);'@cmd;+7 701 000 00 00;-5",
    );
  });
});

describe("neutralizeFormula", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-2+3+cmd|' /C calc'!A0", "'-2+3+cmd|' /C calc'!A0"],
    ["@SUM(1)", "'@SUM(1)"],
    ["\t=1+1", "'\t=1+1"],
    ["\r=1+1", "'\r=1+1"],
    ['=HYPERLINK("http://x","y")', '\'=HYPERLINK("http://x","y")'],
  ])("puts a quote mark before %j", (value, expected) => {
    expect(looksLikeFormula(value)).toBe(true);
    expect(neutralizeFormula(value)).toBe(expected);
  });

  it.each([
    "Ахметов",
    "+77010000001",
    "+7 701 000 00 00",
    "-15000",
    "25 000",
    "",
    "a=b",
  ])("leaves %j as it is", (value) => {
    expect(looksLikeFormula(value)).toBe(false);
    expect(neutralizeFormula(value)).toBe(value);
  });

  it("is applied to every CSV cell, quoting what needs quoting", () => {
    expect(toCsv([["=1;2", '@a"b']])).toBe('\uFEFF"\'=1;2";"\'@a""b"');
  });
});
