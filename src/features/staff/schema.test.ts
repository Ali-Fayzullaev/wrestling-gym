import { describe, expect, it } from "vitest";

import { inviteStaffSchema, staffAccessSchema } from "./schema";

describe("inviteStaffSchema", () => {
  it("lower-cases and trims the email, trims the name", () => {
    expect(
      inviteStaffSchema.parse({
        email: "  Coach@Example.KZ ",
        fullName: "  Ерлан Тренеров ",
        role: "admin",
      }),
    ).toEqual({
      email: "coach@example.kz",
      fullName: "Ерлан Тренеров",
      role: "admin",
    });
  });

  it.each([
    [{ email: "not-an-email", fullName: "Имя", role: "admin" }, "email"],
    [{ email: "a@b.kz", fullName: "  ", role: "admin" }, "fullName"],
    [{ email: "a@b.kz", fullName: "Имя", role: "coach" }, "role"],
  ])("refuses %o on %s", (input, field) => {
    const result = inviteStaffSchema.safeParse(input);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });
});

describe("staffAccessSchema", () => {
  it("needs a uuid, a known role and a boolean", () => {
    expect(
      staffAccessSchema.safeParse({
        staffId: "x",
        role: "owner",
        active: "yes",
      }).success,
    ).toBe(false);
  });
});
