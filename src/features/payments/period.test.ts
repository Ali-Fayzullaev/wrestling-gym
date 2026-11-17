import { describe, expect, it } from "vitest";

import {
  isEndInBounds,
  nextPeriod,
  periodEnd,
  periodEndBounds,
} from "./period";

describe("nextPeriod (criterion 1, D-03)", () => {
  it("first payment starts on the payment day", () => {
    expect(nextPeriod(null, "2026-11-17")).toEqual({
      start: "2026-11-17",
      end: "2026-12-16",
    });
  });

  it("a valid subscription is extended from the day after its end", () => {
    expect(nextPeriod("2026-12-16", "2026-12-10")).toEqual({
      start: "2026-12-17",
      end: "2027-01-16",
    });
  });

  it("a subscription ending on the payment day is extended", () => {
    expect(nextPeriod("2026-11-19", "2026-11-19")).toEqual({
      start: "2026-11-20",
      end: "2026-12-19",
    });
  });

  it("paid 6 days late: continues from the old end, no free days", () => {
    expect(nextPeriod("2026-12-16", "2026-12-22")).toEqual({
      start: "2026-12-17",
      end: "2027-01-16",
    });
  });

  it("paid the day after the end: continues from the old end", () => {
    expect(nextPeriod("2026-11-18", "2026-11-19")).toEqual({
      start: "2026-11-19",
      end: "2026-12-18",
    });
  });

  it("paid on the last day of the following month: still continues (exactly one month late)", () => {
    expect(nextPeriod("2026-12-16", "2027-01-16")).toEqual({
      start: "2026-12-17",
      end: "2027-01-16",
    });
  });

  it("paid the day after the following month would have ended: starts on the payment day", () => {
    expect(nextPeriod("2026-12-16", "2027-01-17")).toEqual({
      start: "2027-01-17",
      end: "2027-02-16",
    });
  });

  it("away longer than a month: starts on the payment day", () => {
    expect(nextPeriod("2026-09-16", "2026-12-22")).toEqual({
      start: "2026-12-22",
      end: "2027-01-21",
    });
    expect(nextPeriod("2025-03-01", "2026-11-19").start).toBe("2026-11-19");
  });

  it("the month after an end on 30 January runs to the end of February", () => {
    // Old end 30.01 → the following month is 31.01–28.02: paying on 28.02 continues, 01.03 not.
    expect(nextPeriod("2026-01-30", "2026-02-28")).toEqual({
      start: "2026-01-31",
      end: "2026-02-28",
    });
    expect(nextPeriod("2026-01-30", "2026-03-01")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
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
    expect(nextPeriod("2026-12-20", "2027-01-05")).toEqual({
      start: "2026-12-21",
      end: "2027-01-20",
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
    expect(() => nextPeriod("16.12.2026", "2026-11-19")).toThrow(RangeError);
  });
});

describe("periodEnd", () => {
  it("is the day before the same day number a month later", () => {
    expect(periodEnd("2026-01-01", 1)).toBe("2026-01-31");
    expect(periodEnd("2026-02-01", 1)).toBe("2026-02-28");
    expect(periodEnd("2026-01-15", 12)).toBe("2027-01-14");
  });
});

describe("periodEndBounds (D-16, STUB bounds)", () => {
  it("late payment: from the payment day to 12 months from the start", () => {
    expect(periodEndBounds("2026-12-17", "2026-12-22")).toEqual({
      min: "2026-12-22",
      max: "2027-12-16",
    });
  });

  it("paid in advance: not before the start of the new period", () => {
    expect(periodEndBounds("2026-12-17", "2026-12-10")).toEqual({
      min: "2026-12-17",
      max: "2027-12-16",
    });
  });

  it("the bounds themselves are allowed, a day outside is not", () => {
    const bounds = periodEndBounds("2026-11-17", "2026-11-17");
    expect(isEndInBounds("2026-11-17", bounds)).toBe(true);
    expect(isEndInBounds("2027-11-16", bounds)).toBe(true);
    expect(isEndInBounds("2026-11-16", bounds)).toBe(false);
    expect(isEndInBounds("2027-11-17", bounds)).toBe(false);
    expect(isEndInBounds("", bounds)).toBe(false);
    expect(isEndInBounds("17.12.2026", bounds)).toBe(false);
  });
});
