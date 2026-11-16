import { describe, expect, it } from "vitest";

import {
  addStaffSchema,
  resetStaffPasswordSchema,
  staffAccessSchema,
} from "./schema";

describe("addStaffSchema", () => {
  it("lower-cases and trims the email, trims the name, keeps the password as typed", () => {
    expect(
      addStaffSchema.parse({
        email: "  Coach@Example.KZ ",
        fullName: "  Ерлан Тренеров ",
        role: "admin",
        password: " temp pass 1 ",
      }),
    ).toEqual({
      email: "coach@example.kz",
      fullName: "Ерлан Тренеров",
      role: "admin",
      password: " temp pass 1 ",
    });
  });

  const valid = {
    email: "a@b.kz",
    fullName: "Имя",
    role: "admin",
    password: "temp-pass-1",
  };

  it.each([
    [{ ...valid, email: "not-an-email" }, "email"],
    [{ ...valid, fullName: "  " }, "fullName"],
    [{ ...valid, role: "coach" }, "role"],
    [{ ...valid, password: "short" }, "password"],
    [{ ...valid, password: "ж".repeat(37) }, "password"],
    [{ ...valid, password: undefined }, "password"],
  ])("refuses %o on %s", (input, field) => {
    const result = addStaffSchema.safeParse(input);
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

describe("resetStaffPasswordSchema", () => {
  it("needs a uuid and a password of 8 characters to 72 bytes", () => {
    const staffId = "00000000-0000-4000-8000-000000000002";
    expect(
      resetStaffPasswordSchema.safeParse({ staffId, password: "12345678" })
        .success,
    ).toBe(true);
    expect(
      resetStaffPasswordSchema.safeParse({ staffId, password: "1234567" })
        .success,
    ).toBe(false);
    expect(
      resetStaffPasswordSchema.safeParse({ staffId: "x", password: "12345678" })
        .success,
    ).toBe(false);
  });
});
