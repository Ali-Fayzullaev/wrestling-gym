import { describe, expect, it } from "vitest";

import { activeKinds, daysForKind } from "./kinds";
import { formatWhen, kindLabel } from "./labels";

const NOW = new Date("2026-11-14T09:00:00Z"); // 14:00 in Almaty

describe("kindLabel", () => {
  it("names the kinds with the configured days", () => {
    expect(kindLabel("before_7", [7, 1])).toBe(
      "Первое напоминание (за 7 дней)",
    );
    expect(kindLabel("before_1", [7, 1])).toBe("Второе (за 1 день)");
    expect(kindLabel("overdue", [7, 1])).toBe("В день окончания");
  });

  it("follows the days the owner set, with the right word form", () => {
    expect(kindLabel("before_7", [3, 2])).toBe("Первое напоминание (за 3 дня)");
    expect(kindLabel("before_1", [21, 11])).toBe("Второе (за 11 дней)");
    expect(kindLabel("before_7", [21])).toBe("Первое напоминание (за 21 день)");
  });
});

describe("daysForKind and activeKinds", () => {
  it("takes the larger day as the first reminder whatever the order", () => {
    expect(daysForKind("before_7", [1, 7])).toBe(7);
    expect(daysForKind("before_1", [1, 7])).toBe(1);
    expect(daysForKind("overdue", [7, 1])).toBe(0);
  });

  it("has no second reminder with one configured day", () => {
    expect(activeKinds([5])).toEqual(["before_7", "overdue"]);
    expect(activeKinds([7, 1])).toEqual(["before_7", "before_1", "overdue"]);
  });
});

describe("formatWhen", () => {
  it("shows only the time for today in Almaty", () => {
    expect(formatWhen("2026-11-14T09:32:00Z", NOW)).toBe("14:32");
  });

  it("adds the date for another day, judged in Almaty, not UTC", () => {
    // 23:30 UTC on 13 November is 04:30 on 14 November in Almaty: still today.
    expect(formatWhen("2026-11-13T23:30:00Z", NOW)).toBe("04:30");
    expect(formatWhen("2026-11-12T09:32:00Z", NOW)).toBe("12 ноября, 14:32");
  });
});
