import { describe, expect, it } from "vitest";

import { bootstrapOwnerSchema } from "./bootstrap";

const valid = {
  email: "owner@example.kz",
  fullName: "  Имя Фамилия  ",
  password: "correct horse",
};

describe("bootstrapOwnerSchema", () => {
  it("accepts an email, a name and a password, trimming the name", () => {
    expect(bootstrapOwnerSchema.parse(valid)).toEqual({
      ...valid,
      fullName: "Имя Фамилия",
    });
  });

  it("keeps the password exactly as typed, spaces included", () => {
    const password = " eight ch ";
    expect(bootstrapOwnerSchema.parse({ ...valid, password }).password).toBe(
      password,
    );
  });

  it.each([
    ["a password shorter than 8 characters", { password: "1234567" }],
    ["a password longer than bcrypt's 72 bytes", { password: "x".repeat(73) }],
    ["a missing password", { password: undefined }],
    ["an invalid email", { email: "owner" }],
    ["an empty name", { fullName: "   " }],
  ])("refuses %s", (_case, override) => {
    expect(
      bootstrapOwnerSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });

  it("counts the 72-byte limit in bytes, not characters", () => {
    // Cyrillic letters are 2 bytes in UTF-8: 37 of them are 74 bytes.
    expect(
      bootstrapOwnerSchema.safeParse({ ...valid, password: "ж".repeat(37) })
        .success,
    ).toBe(false);
    expect(
      bootstrapOwnerSchema.safeParse({ ...valid, password: "ж".repeat(36) })
        .success,
    ).toBe(true);
  });
});
