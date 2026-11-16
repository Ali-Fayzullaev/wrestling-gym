import { describe, expect, it } from "vitest";

import { parseStaffAccess } from "./access";

describe("parseStaffAccess", () => {
  it("reads the role, the temporary-password flag and the language", () => {
    expect(
      parseStaffAccess({
        role: "admin",
        must_change_password: true,
        locale: "kk",
      }),
    ).toEqual({ role: "admin", mustChangePassword: true, locale: "kk" });
  });

  it("falls back to Russian for a missing or unknown language", () => {
    expect(
      parseStaffAccess({ role: "owner", must_change_password: false }),
    ).toEqual({ role: "owner", mustChangePassword: false, locale: "ru" });
    expect(
      parseStaffAccess({
        role: "owner",
        must_change_password: false,
        locale: "en",
      })?.locale,
    ).toBe("ru");
  });

  it.each([
    null,
    undefined,
    "owner",
    { role: "coach", must_change_password: false },
    { role: "owner" },
  ])("treats %o as no access", (data) => {
    expect(parseStaffAccess(data)).toBeNull();
  });
});
