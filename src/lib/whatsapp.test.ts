import { describe, expect, it } from "vitest";

import { buildWaLink } from "./whatsapp";

const PHONE = "+77011234567";

function textOf(link: string): string {
  const url = new URL(link);
  return url.searchParams.get("text") ?? "";
}

describe("buildWaLink", () => {
  it("puts the number without + into the path", () => {
    const link = buildWaLink(PHONE, "Привет");
    expect(link.startsWith("https://wa.me/77011234567?text=")).toBe(true);
    expect(link).not.toContain("+7");
  });

  it("encodes Cyrillic and Kazakh letters and decodes back to the same text", () => {
    const text = "Сәлеметсіз бе, Әлихан! Ғ Қ Ң Ө Ұ Ү Һ І ә ғ қ ң ө ұ ү һ і";
    const link = buildWaLink(PHONE, text);
    expect(link).toMatch(/^[\x21-\x7e]+$/);
    expect(textOf(link)).toBe(text);
  });

  it("encodes Uzbek Cyrillic letters and decodes back to the same text", () => {
    const text = "Ассалому алайкум, Ўғилой! Ў ў Қ қ Ғ ғ Ҳ ҳ, 16 январ";
    const link = buildWaLink(PHONE, text);
    expect(link).toMatch(/^[\x21-\x7e]+$/);
    expect(textOf(link)).toBe(text);
  });

  it("keeps line breaks as %0A", () => {
    const link = buildWaLink(PHONE, "Строка 1\nСтрока 2");
    expect(link).toContain("%0A");
    expect(textOf(link)).toBe("Строка 1\nСтрока 2");
  });

  it("encodes & # + ? = so they cannot break the query", () => {
    const text = "Сумма & скидка #1 + бонус? a=b";
    const link = buildWaLink(PHONE, text);
    const query = link.split("?text=")[1] ?? "";
    for (const raw of ["&", "#", "+", "?", "=", " "]) {
      expect(query).not.toContain(raw);
    }
    expect(query).toContain("%26");
    expect(query).toContain("%23");
    expect(textOf(link)).toBe(text);
  });

  it("refuses a number that is not +77XXXXXXXXX", () => {
    for (const bad of ["87011234567", "77011234567", "+7701123456", ""]) {
      expect(() => buildWaLink(bad, "x")).toThrow(RangeError);
    }
  });

  it("does not echo the number in its error", () => {
    expect(() => buildWaLink("+7123", "x")).toThrow(/^(?!.*7123).*$/);
  });
});
