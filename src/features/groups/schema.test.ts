import { describe, expect, it } from "vitest";

import {
  archiveGroupSchema,
  groupFormToRaw,
  groupInputSchema,
  moveClientsSchema,
} from "./schema";

const COACH = "00000000-0000-4000-8000-000000000002";
const valid = {
  name: "Дети 6–9 лет",
  coachId: COACH,
  schedule: [{ day: 1, start: "09:00", end: "10:00" }],
  defaultPrice: "15 000",
  capacity: "30",
};

function issuesFor(input: Record<string, unknown>): string[] {
  const result = groupInputSchema.safeParse(input);
  // Which fields are wrong, each once: one bad value can break several rules.
  return result.success
    ? []
    : [...new Set(result.error.issues.map((i) => String(i.path[0])))];
}

describe("groupInputSchema (criterion 4)", () => {
  it("accepts a valid group and normalises numbers and the name", () => {
    const result = groupInputSchema.parse({ ...valid, name: "  Взрослые  " });
    expect(result).toEqual({
      name: "Взрослые",
      coachId: COACH,
      schedule: [{ day: 1, start: "09:00", end: "10:00" }],
      defaultPrice: 15000,
      capacity: 30,
    });
  });

  it.each(["", "   "])("rejects an empty name %j", (name) => {
    expect(issuesFor({ ...valid, name })).toEqual(["name"]);
  });

  it("rejects a name over 100 characters", () => {
    expect(issuesFor({ ...valid, name: "а".repeat(101) })).toEqual(["name"]);
  });

  it.each(["-1", "-15000", "0", "15.5", "abc", ""])(
    "rejects the price %j",
    (defaultPrice) => {
      expect(issuesFor({ ...valid, defaultPrice })).toEqual(["defaultPrice"]);
    },
  );

  it.each(["0", "-3", "501", "2.5"])("rejects the capacity %j", (capacity) => {
    expect(issuesFor({ ...valid, capacity })).toEqual(["capacity"]);
  });

  it("treats an empty capacity as no limit", () => {
    expect(groupInputSchema.parse({ ...valid, capacity: "" }).capacity).toBe(
      null,
    );
  });

  it("rejects a session that ends before it starts, a bad time and a repeated day", () => {
    expect(
      issuesFor({
        ...valid,
        schedule: [{ day: 1, start: "10:00", end: "09:00" }],
      }),
    ).toEqual(["schedule"]);
    expect(
      issuesFor({
        ...valid,
        schedule: [{ day: 1, start: "9:00", end: "10:00" }],
      }),
    ).toEqual(["schedule"]);
    expect(
      issuesFor({
        ...valid,
        schedule: [
          { day: 2, start: "09:00", end: "10:00" },
          { day: 2, start: "18:00", end: "19:00" },
        ],
      }),
    ).toEqual(["schedule"]);
    expect(
      issuesFor({
        ...valid,
        schedule: [{ day: 8, start: "09:00", end: "10:00" }],
      }),
    ).toEqual(["schedule"]);
  });

  it("sorts sessions by week day", () => {
    const schedule = groupInputSchema.parse({
      ...valid,
      schedule: [
        { day: 5, start: "09:00", end: "10:00" },
        { day: 1, start: "09:00", end: "10:00" },
      ],
    }).schedule;
    expect(schedule.map((s) => s.day)).toEqual([1, 5]);
  });

  it("rejects a coach that is not a uuid", () => {
    expect(issuesFor({ ...valid, coachId: "" })).toEqual(["coachId"]);
  });
});

describe("groupFormToRaw", () => {
  it("turns ticked days into sessions and ignores unticked ones", () => {
    const form = new FormData();
    form.set("name", "Группа");
    form.set("coachId", COACH);
    form.set("defaultPrice", "20000");
    form.set("capacity", "");
    form.set("day-3", "on");
    form.set("start-3", "18:00");
    form.set("end-3", "19:30");
    form.set("start-4", "07:00");
    form.set("end-4", "08:00");
    expect(groupInputSchema.parse(groupFormToRaw(form))).toEqual({
      name: "Группа",
      coachId: COACH,
      schedule: [{ day: 3, start: "18:00", end: "19:30" }],
      defaultPrice: 20000,
      capacity: null,
    });
  });
});

describe("moveClientsSchema and archiveGroupSchema", () => {
  const id = "20000000-0000-4000-8000-000000000001";

  it("requires at least one client and drops repeats", () => {
    expect(
      moveClientsSchema.safeParse({ clientIds: [], targetGroupId: COACH })
        .success,
    ).toBe(false);
    expect(
      moveClientsSchema.parse({ clientIds: [id, id], targetGroupId: COACH })
        .clientIds,
    ).toEqual([id]);
  });

  it("rejects ids that are not uuids", () => {
    expect(
      moveClientsSchema.safeParse({ clientIds: ["1"], targetGroupId: COACH })
        .success,
    ).toBe(false);
    expect(
      archiveGroupSchema.safeParse({ groupId: "x", force: false }).success,
    ).toBe(false);
  });
});
