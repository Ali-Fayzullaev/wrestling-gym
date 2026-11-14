import { describe, expect, it } from "vitest";

import { formatSchedule, formatSeats, seatState } from "./format";

describe("formatSchedule", () => {
  it("lists days that share a time together", () => {
    expect(
      formatSchedule([
        { day: 5, start: "09:00", end: "10:00" },
        { day: 1, start: "09:00", end: "10:00" },
        { day: 6, start: "11:00", end: "12:00" },
        { day: 3, start: "09:00", end: "10:00" },
      ]),
    ).toBe("Пн, Ср, Пт 09:00–10:00 · Сб 11:00–12:00");
  });

  it("says when there is no schedule", () => {
    expect(formatSchedule([])).toBe("Расписание не задано");
  });
});

describe("seats", () => {
  it.each([
    [10, null, "unlimited", "10"],
    [24, 30, "free", "24 / 30"],
    [30, 30, "full", "30 / 30"],
    [31, 30, "over", "31 / 30"],
  ] as const)("%i of %s is %s", (members, capacity, state, text) => {
    expect(seatState(members, capacity)).toBe(state);
    expect(formatSeats(members, capacity)).toBe(text);
  });
});
