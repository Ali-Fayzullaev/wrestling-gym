import { describe, expect, it } from "vitest";

import { archiveParentSchema, deleteParentSchema } from "./schema";

const ID = "3f1c2a7e-0000-4000-8000-000000000001";

describe("archiveParentSchema", () => {
  it("accepts a parent id and the wanted state", () => {
    expect(
      archiveParentSchema.safeParse({ parentId: ID, archived: true }).success,
    ).toBe(true);
  });

  it("refuses a non-UUID id and a missing state", () => {
    expect(
      archiveParentSchema.safeParse({ parentId: "x", archived: true }).success,
    ).toBe(false);
    expect(archiveParentSchema.safeParse({ parentId: ID }).success).toBe(false);
  });
});

describe("deleteParentSchema", () => {
  const valid = { parentId: ID, reason: "duplicate", name: " Айгуль " };

  it("accepts a reason from the list and trims the typed name", () => {
    const parsed = deleteParentSchema.safeParse(valid);
    expect(parsed.success && parsed.data.name).toBe("Айгуль");
  });

  it.each([
    ["free-text reason", { ...valid, reason: "мама попросила" }],
    ["empty name", { ...valid, name: "   " }],
    ["too long name", { ...valid, name: "а".repeat(101) }],
    ["non-UUID id", { ...valid, parentId: "1" }],
  ])("refuses a %s", (_, value) => {
    expect(deleteParentSchema.safeParse(value).success).toBe(false);
  });
});
