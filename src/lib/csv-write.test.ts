import { describe, expect, it } from "vitest";

import { toCsv } from "./csv-write";

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
