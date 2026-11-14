import { describe, expect, it } from "vitest";

import { nextPeriod, periodEnd } from "./period";

describe("nextPeriod (criterion 1, STUB(D-03) default rule)", () => {
  it("first payment starts on the payment day", () => {
    expect(nextPeriod(null, "2026-11-19")).toEqual({
      start: "2026-11-19",
      end: "2026-12-18",
    });
  });

  it("a valid subscription is extended from the day after its end", () => {
    expect(nextPeriod("2026-11-25", "2026-11-19")).toEqual({
      start: "2026-11-26",
      end: "2026-12-25",
    });
  });

  it("a subscription ending on the payment day is still valid: extended", () => {
    expect(nextPeriod("2026-11-19", "2026-11-19")).toEqual({
      start: "2026-11-20",
      end: "2026-12-19",
    });
  });

  it("an expired subscription restarts on the payment day", () => {
    expect(nextPeriod("2026-11-18", "2026-11-19")).toEqual({
      start: "2026-11-19",
      end: "2026-12-18",
    });
    expect(nextPeriod("2025-03-01", "2026-11-19").start).toBe("2026-11-19");
  });

  it("31 January runs to the end of February (28 or 29 days)", () => {
    expect(nextPeriod(null, "2026-01-31").end).toBe("2026-02-28");
    expect(nextPeriod(null, "2028-01-31").end).toBe("2028-02-29");
    expect(nextPeriod(null, "2026-01-30").end).toBe("2026-02-28");
    expect(nextPeriod(null, "2026-01-29").end).toBe("2026-02-28");
    expect(nextPeriod(null, "2028-01-29").end).toBe("2028-02-28");
  });

  it("after February the next period starts on 1 March and ends on 31 March", () => {
    expect(nextPeriod("2026-02-28", "2026-02-20")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
  });

  it("31st of a month before a 30-day month ends on the 30th", () => {
    expect(nextPeriod(null, "2026-03-31").end).toBe("2026-04-30");
  });

  it("crosses the end of the year", () => {
    expect(nextPeriod(null, "2026-12-15")).toEqual({
      start: "2026-12-15",
      end: "2027-01-14",
    });
    expect(nextPeriod("2026-12-31", "2026-12-28")).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
    expect(nextPeriod(null, "2026-12-31").end).toBe("2027-01-30");
  });

  it("several months", () => {
    expect(nextPeriod(null, "2026-11-01", 3).end).toBe("2027-01-31");
    expect(nextPeriod(null, "2026-11-30", 3).end).toBe("2027-02-28");
  });

  it("rejects a month count outside 1..12 and malformed dates", () => {
    expect(() => nextPeriod(null, "2026-11-19", 0)).toThrow(RangeError);
    expect(() => nextPeriod(null, "2026-11-19", 1.5)).toThrow(RangeError);
    expect(() => nextPeriod(null, "19.11.2026")).toThrow(RangeError);
  });
});

describe("periodEnd", () => {
  it("is the day before the same day number a month later", () => {
    expect(periodEnd("2026-01-01", 1)).toBe("2026-01-31");
    expect(periodEnd("2026-02-01", 1)).toBe("2026-02-28");
    expect(periodEnd("2026-01-15", 12)).toBe("2027-01-14");
  });
});
