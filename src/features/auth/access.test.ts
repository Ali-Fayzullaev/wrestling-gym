import { describe, expect, it } from "vitest";

import { parseStaffAccess } from "./access";

describe("parseStaffAccess", () => {
  it("reads the role and the temporary-password flag", () => {
    expect(
      parseStaffAccess({ role: "admin", must_change_password: true }),
    ).toEqual({ role: "admin", mustChangePassword: true });
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
