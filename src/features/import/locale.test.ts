import { describe, expect, it } from "vitest";

import { parseMessageLocale } from "./locale";

describe("parseMessageLocale", () => {
  it.each([
    ["ru", "ru"],
    ["RU", "ru"],
    ["русский", "ru"],
    ["Русский ", "ru"],
    ["kk", "kk"],
    ["казахский", "kk"],
    ["Қазақша", "kk"],
    ["uz", "uz"],
    ["узбекский", "uz"],
    ["Ўзбекча", "uz"],
  ])("reads %j as %s", (text, locale) => {
    expect(parseMessageLocale(text)).toEqual({ ok: true, value: locale });
  });

  it("takes an empty cell as Russian", () => {
    expect(parseMessageLocale("")).toEqual({ ok: true, value: "ru" });
    expect(parseMessageLocale("   ")).toEqual({ ok: true, value: "ru" });
  });

  it.each(["en", "английский", "uz-Latn", "o'zbekcha", "kz", "1"])(
    "refuses %j",
    (text) => {
      expect(parseMessageLocale(text)).toEqual({ ok: false });
    },
  );
});
