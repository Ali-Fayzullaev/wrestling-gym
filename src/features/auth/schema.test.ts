import { describe, expect, it } from "vitest";

import { newPasswordSchema, passwordSchema, signInSchema } from "./schema";

describe("passwordSchema", () => {
  it("accepts 8 characters and 72 bytes", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
  });

  it("refuses fewer than 8 characters", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
  });

  it("counts bytes, not characters: 37 Cyrillic letters are 74 bytes", () => {
    expect(passwordSchema.safeParse("ж".repeat(36)).success).toBe(true);
    expect(passwordSchema.safeParse("ж".repeat(37)).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("needs the confirmation to match", () => {
    const result = newPasswordSchema.safeParse({
      password: "long-enough",
      confirm: "long-enougH",
    });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "confirm",
    ]);
  });
});

describe("signInSchema", () => {
  it("refuses a password over 72 bytes before it reaches Auth", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.kz", password: "ж".repeat(37) })
        .success,
    ).toBe(false);
  });
});
