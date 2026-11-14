import { describe, expect, it } from "vitest";

import {
  currentMonth,
  formatMonth,
  monthStart,
  parseMonth,
  shiftMonth,
} from "./month";

// 2026-11-30 23:30 in Almaty (18:30 UTC).
const LATE_NOVEMBER = new Date("2026-11-30T18:30:00Z");
// 2026-12-01 00:30 in Almaty, but 2026-11-30 19:30 in UTC.
const EARLY_DECEMBER = new Date("2026-11-30T19:30:00Z");

describe("currentMonth", () => {
  it("is the Almaty month, not the UTC one", () => {
    expect(currentMonth(LATE_NOVEMBER)).toBe("2026-11");
    expect(currentMonth(EARLY_DECEMBER)).toBe("2026-12");
  });
});

describe("shiftMonth", () => {
  it.each([
    ["2026-11", -1, "2026-10"],
    ["2026-01", -1, "2025-12"],
    ["2026-12", 1, "2027-01"],
    ["2026-05", -17, "2024-12"],
  ])("%s %i -> %s", (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected);
  });
});

describe("parseMonth", () => {
  it("keeps a valid past or current month", () => {
    expect(parseMonth("2026-10", LATE_NOVEMBER)).toBe("2026-10");
    expect(parseMonth("2026-11", LATE_NOVEMBER)).toBe("2026-11");
    expect(parseMonth("2020-01", LATE_NOVEMBER)).toBe("2020-01");
  });

  it.each([
    undefined,
    ["2026-10"],
    "2026-13",
    "2026-1",
    "2026-00",
    "26-10",
    "2026-10-01",
    "2026-12",
    "2019-12",
    "<script>",
  ])("falls back to the current month for %j", (value) => {
    expect(parseMonth(value, LATE_NOVEMBER)).toBe("2026-11");
  });
});

describe("monthStart and formatMonth", () => {
  it("gives the first day and the Russian month name", () => {
    expect(monthStart("2026-11")).toBe("2026-11-01");
    expect(formatMonth("2026-11")).toBe("Ноябрь 2026");
    expect(formatMonth("2027-01")).toBe("Январь 2027");
  });
});
