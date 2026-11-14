import { describe, expect, it } from "vitest";

import { parseEndDate } from "./dates";

describe("parseEndDate", () => {
  it.each([
    ["18.11.2025", "2025-11-18"],
    ["8.1.2026", "2026-01-08"],
    ["18/11/2025", "2025-11-18"],
    ["18-11-2025", "2025-11-18"],
    ["18.11.25", "2025-11-18"],
    ["2025-11-18", "2025-11-18"],
    ["2025-11-18T00:00:00", "2025-11-18"],
    [" 29.02.2028 ", "2028-02-29"],
  ])("reads the text %j", (cell, expected) => {
    expect(parseEndDate(cell)).toEqual({ ok: true, value: expected });
  });

  it.each([
    // Excel day numbers: 45979 = 18 Nov 2025, 46023 = 1 Jan 2026; time of day is ignored.
    [45979, "2025-11-18"],
    [46023, "2026-01-01"],
    [45979.75, "2025-11-18"],
  ])("reads the Excel day number %d", (cell, expected) => {
    expect(parseEndDate(cell)).toEqual({ ok: true, value: expected });
  });

  it("reads an Excel day number saved to CSV as text", () => {
    expect(parseEndDate("45979")).toEqual({ ok: true, value: "2025-11-18" });
  });

  it("treats an empty cell as no date", () => {
    expect(parseEndDate(null)).toEqual({ ok: true, value: null });
    expect(parseEndDate("   ")).toEqual({ ok: true, value: null });
  });

  it.each([
    "31.02.2026",
    "29.02.2027",
    "18.13.2025",
    "завтра",
    "18.11",
    "01.01.1999",
    "2025/11/18x",
  ])("refuses %j", (cell) => {
    expect(parseEndDate(cell)).toEqual({ ok: false });
  });

  it("refuses numbers that are not plausible dates", () => {
    expect(parseEndDate(12)).toEqual({ ok: false });
    expect(parseEndDate(87011234567)).toEqual({ ok: false });
  });
});
