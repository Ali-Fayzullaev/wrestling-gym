import { describe, expect, it } from "vitest";

import { type MessageKey, ru, t } from "./index";

describe("t", () => {
  it("returns the text at a dotted key", () => {
    expect(t("nav.today")).toBe(ru.nav.today);
    expect(t("status.expired")).toBe("Долг");
    expect(t("app.name")).toBe(ru.app.name);
  });

  it("rejects unknown keys and keys of parameterised texts at compile time", () => {
    // @ts-expect-error unknown key
    const unknown: MessageKey = "nav.nowhere";
    // @ts-expect-error a text with parameters is called on `ru`, not looked up by key
    const withParams: MessageKey = "auth.tooManyAttempts";
    // @ts-expect-error a group of texts is not a text
    const group: MessageKey = "nav";
    expect(() => t(unknown)).toThrow("Missing text: nav.nowhere");
    expect(() => t(withParams)).toThrow();
    expect(() => t(group)).toThrow();
  });
});
