import { describe, expect, it } from "vitest";

import { guestLocale, isLocale, negotiateLocale, parseLocale } from "./locale";

describe("negotiateLocale", () => {
  it.each([
    ["kk-KZ,ru;q=0.8", "kk"],
    ["ru-RU,ru;q=0.9,en;q=0.8", "ru"],
    ["uz-Cyrl-UZ,uz;q=0.9", "uz"],
    ["en-US,kk;q=0.5,ru;q=0.7", "ru"],
    ["en-US,en;q=0.9", null],
    ["", null],
  ])("%s gives %s", (header, locale) => {
    expect(negotiateLocale(header)).toBe(locale);
  });

  it("skips Uzbek in Latin script, which the app does not offer", () => {
    expect(negotiateLocale("uz-Latn-UZ,ru;q=0.5")).toBe("ru");
  });

  it("ignores languages with zero quality and broken weights", () => {
    expect(negotiateLocale("kk;q=0,uz;q=0.4")).toBe("uz");
    expect(negotiateLocale("kk;q=abc,ru;q=0.1")).toBe("ru");
  });

  it("is null without a header", () => {
    expect(negotiateLocale(null)).toBeNull();
  });
});

describe("guestLocale", () => {
  it("prefers the cookie, then the browser, then Russian", () => {
    expect(guestLocale("uz", "kk-KZ")).toBe("uz");
    expect(guestLocale(undefined, "kk-KZ")).toBe("kk");
    expect(guestLocale("en", "kk-KZ")).toBe("kk");
    expect(guestLocale(undefined, null)).toBe("ru");
  });
});

describe("parseLocale", () => {
  it("accepts only the three languages", () => {
    expect(isLocale("kk")).toBe(true);
    expect(isLocale("en")).toBe(false);
    expect(parseLocale("uz")).toBe("uz");
    expect(parseLocale("<script>")).toBe("ru");
    expect(parseLocale(null)).toBe("ru");
  });
});
