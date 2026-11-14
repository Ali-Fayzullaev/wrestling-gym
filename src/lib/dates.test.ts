import { describe, expect, it } from "vitest";

import { businessDate, businessDateTime } from "./dates";

describe("businessDate", () => {
  it("returns the Almaty calendar date for a midday instant", () => {
    expect(businessDate(new Date("2026-03-15T07:00:00Z"))).toBe("2026-03-15");
  });

  it("stays on the same day one minute before Almaty midnight (UTC+5)", () => {
    expect(businessDate(new Date("2026-03-15T18:59:00Z"))).toBe("2026-03-15");
  });

  it("switches to the next day exactly at Almaty midnight (UTC+5)", () => {
    expect(businessDate(new Date("2026-03-15T19:00:00Z"))).toBe("2026-03-16");
  });

  it("handles the year boundary", () => {
    expect(businessDate(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
  });
});

describe("businessDateTime", () => {
  it("writes the Almaty date and time, 23:30 on the 30th staying on the 30th", () => {
    expect(businessDateTime(new Date("2026-11-30T18:30:00Z"))).toBe(
      "2026-11-30 23:30",
    );
  });

  it("uses 00:xx after midnight, not 24:xx", () => {
    expect(businessDateTime(new Date("2026-11-30T19:05:00Z"))).toBe(
      "2026-12-01 00:05",
    );
  });
});
