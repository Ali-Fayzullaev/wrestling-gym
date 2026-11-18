import { describe, expect, it } from "vitest";

import {
  historyFilterSchema,
  openReminderSchema,
  reminderDaysOf,
  reminderSettingsSchema,
} from "./schema";

const ID = "3f1c2a7e-0000-4000-8000-000000000001";
const ID2 = "3f1c2a7e-0000-4000-8000-000000000002";

function settings(overrides: Record<string, unknown> = {}) {
  return reminderSettingsSchema.safeParse({
    firstDays: "7",
    secondDays: "1",
    templates: [{ id: ID, body: "Текст" }],
    ...overrides,
  });
}

describe("reminderSettingsSchema", () => {
  it("accepts form strings and stores the early reminder first", () => {
    const parsed = settings();
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(reminderDaysOf(parsed.data)).toEqual([7, 1]);
  });

  it("treats an empty second day as no second reminder", () => {
    const parsed = settings({ secondDays: "" });
    expect(parsed.success && reminderDaysOf(parsed.data)).toEqual([7]);
  });

  it.each([
    ["first 0", { firstDays: "0" }, "firstDays"],
    ["first 61", { firstDays: "61" }, "firstDays"],
    ["first 2.5", { firstDays: "2.5" }, "firstDays"],
    ["second equal to first", { secondDays: "7" }, "secondDays"],
    ["second larger than first", { secondDays: "10" }, "secondDays"],
    ["second not a number", { secondDays: "abc" }, "secondDays"],
  ])("refuses %s", (_, overrides, field) => {
    const parsed = settings(overrides);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it("trims texts, keeps line breaks as \\n and refuses empty or too long ones", () => {
    const parsed = settings({ templates: [{ id: ID, body: "  А\r\nБ  " }] });
    expect(parsed.success && parsed.data.templates[0]?.body).toBe("А\nБ");
    expect(settings({ templates: [{ id: ID, body: "   " }] }).success).toBe(
      false,
    );
    expect(
      settings({ templates: [{ id: ID, body: "я".repeat(1001) }] }).success,
    ).toBe(false);
  });

  it("refuses the same template twice and a malformed id", () => {
    expect(
      settings({
        templates: [
          { id: ID, body: "А" },
          { id: ID, body: "Б" },
        ],
      }).success,
    ).toBe(false);
    expect(settings({ templates: [{ id: "x", body: "А" }] }).success).toBe(
      false,
    );
    expect(
      settings({
        templates: [
          { id: ID, body: "А" },
          { id: ID2, body: "Б" },
        ],
      }).success,
    ).toBe(true);
  });

  it("takes a text per kind and language (12, the several-children text included) and no more", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        body: "Текст",
      }));
    expect(settings({ templates: ids(12) }).success).toBe(true);
    expect(settings({ templates: ids(13) }).success).toBe(false);
  });
});

describe("openReminderSchema", () => {
  it("accepts a uuid and a known kind only", () => {
    expect(
      openReminderSchema.safeParse({ paymentId: ID, kind: "overdue" }).success,
    ).toBe(true);
    expect(
      openReminderSchema.safeParse({ paymentId: ID, kind: "before_3" }).success,
    ).toBe(false);
    expect(
      openReminderSchema.safeParse({ paymentId: "1", kind: "overdue" }).success,
    ).toBe(false);
  });

  it("step 20: takes ru, kk or uz as the language of this message, or none", () => {
    for (const locale of ["ru", "kk", "uz"]) {
      expect(
        openReminderSchema.safeParse({ paymentId: ID, kind: "overdue", locale })
          .data?.locale,
      ).toBe(locale);
    }
    expect(
      openReminderSchema.safeParse({ paymentId: ID, kind: "overdue" }).data,
    ).toEqual({ paymentId: ID, kind: "overdue" });
    for (const locale of ["en", "uz-Cyrl", "", null, 1]) {
      expect(
        openReminderSchema.safeParse({ paymentId: ID, kind: "overdue", locale })
          .success,
      ).toBe(false);
    }
  });
});

describe("historyFilterSchema", () => {
  it("keeps a valid date and staff id and drops anything malformed", () => {
    expect(
      historyFilterSchema.parse({ date: "2026-11-14", staff: ID }),
    ).toEqual({
      date: "2026-11-14",
      staff: ID,
    });
    expect(
      historyFilterSchema.parse({ date: "14.11.2026", staff: "x" }),
    ).toEqual({});
    expect(historyFilterSchema.parse({ date: ["2026-11-14"] })).toEqual({});
  });
});

describe("openReminderSchema: one message to a parent (D-18)", () => {
  const PARENT = "3f1c2a7e-0000-4000-8000-000000000003";
  const items = [
    { paymentId: ID, kind: "before_7" },
    { paymentId: ID2, kind: "overdue" },
  ];
  const parse = (raw: unknown) => openReminderSchema.safeParse(raw);

  it("accepts a parent with two or more children's reminders and a language", () => {
    expect(parse({ parentId: PARENT, items, locale: "kk" }).data).toEqual({
      parentId: PARENT,
      items,
      locale: "kk",
    });
  });

  it.each([
    ["one child", { parentId: PARENT, items: items.slice(0, 1) }],
    [
      "the same payment twice",
      { parentId: PARENT, items: [items[0], items[0]] },
    ],
    ["a bad parent id", { parentId: "Айгуль", items }],
    [
      "a bad kind",
      {
        parentId: PARENT,
        items: [items[0], { paymentId: ID2, kind: "family" }],
      },
    ],
    [
      "more than 20 children",
      {
        parentId: PARENT,
        items: Array.from({ length: 21 }, (_, i) => ({
          paymentId: `3f1c2a7e-0000-4000-8000-${String(i).padStart(12, "0")}`,
          kind: "overdue",
        })),
      },
    ],
    [
      "a mix of both shapes",
      { parentId: PARENT, items, paymentId: ID, kind: "overdue" },
    ],
  ])("refuses %s", (_label, raw) => {
    expect(parse(raw).success).toBe(false);
  });
});
