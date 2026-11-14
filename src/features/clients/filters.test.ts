import { describe, expect, it } from "vitest";

import {
  type ClientRow,
  DEFAULT_FILTERS,
  filtersToSearch,
  type GroupOption,
  hasActiveFilters,
  indexRows,
  NO_ACTIVE_GROUP,
  parseFilters,
  visibleRows,
} from "./filters";

const KIDS = "10000000-0000-4000-8000-000000000001";
const ADULTS = "10000000-0000-4000-8000-000000000005";
const OLD = "10000000-0000-4000-8000-000000000009";
const COACH_A = "00000000-0000-4000-8000-000000000002";
const COACH_B = "00000000-0000-4000-8000-000000000001";

const groups = new Map<string, GroupOption>([
  [KIDS, { id: KIDS, name: "Дети", coachId: COACH_A, archived: false }],
  [ADULTS, { id: ADULTS, name: "Взрослые", coachId: COACH_B, archived: false }],
  [OLD, { id: OLD, name: "Старая", coachId: COACH_A, archived: true }],
]);

function row(
  id: string,
  lastName: string,
  overrides: Partial<ClientRow> = {},
): ClientRow {
  return {
    id,
    lastName,
    firstName: "Имя",
    phone: `+7700000000${id}`,
    groupId: KIDS,
    archived: false,
    status: "active",
    endsOn: "2026-12-01",
    ...overrides,
  };
}

const rows = indexRows([
  row("1", "Қасымов", { status: "expired", endsOn: "2026-11-01" }),
  row("2", "Ахметов", {
    groupId: ADULTS,
    status: "expiring",
    endsOn: "2026-11-15",
  }),
  row("3", "Бекенов", { groupId: ADULTS, status: "none", endsOn: null }),
  row("4", "Ёлкин", { groupId: OLD, status: "expired", endsOn: "2026-10-01" }),
  row("5", "Жумабаев", {
    groupId: null,
    status: "active",
    endsOn: "2026-12-20",
  }),
  row("6", "Архивов", {
    archived: true,
    status: "expired",
    endsOn: "2026-09-01",
  }),
  row("7", "Алиев", { status: "active", endsOn: "2026-11-15" }),
]);

const ids = (filters: Partial<typeof DEFAULT_FILTERS>, query = "") =>
  visibleRows(rows, { ...DEFAULT_FILTERS, ...filters }, groups, query).map(
    (r) => r.id,
  );

describe("visibleRows: filters", () => {
  it("hides archived clients by default, sorted by last name (ё as е)", () => {
    expect(ids({})).toEqual(["7", "2", "3", "4", "5", "1"]);
  });

  it("archive filter shows only archived clients", () => {
    expect(ids({ archived: true })).toEqual(["6"]);
  });

  it("group + status", () => {
    expect(ids({ group: ADULTS, status: "none" })).toEqual(["3"]);
    expect(ids({ group: KIDS, status: "expired" })).toEqual(["1"]);
  });

  it("no active group: without a group or in an archived one", () => {
    expect(ids({ group: NO_ACTIVE_GROUP })).toEqual(["4", "5"]);
    expect(ids({ group: NO_ACTIVE_GROUP, status: "expired" })).toEqual(["4"]);
  });

  it("coach of the active group only", () => {
    expect(ids({ coach: COACH_A })).toEqual(["7", "1"]);
    expect(ids({ coach: COACH_B, status: "expiring" })).toEqual(["2"]);
  });

  it("group + coach that do not match give nothing", () => {
    expect(ids({ group: KIDS, coach: COACH_B })).toEqual([]);
  });

  it("filters + search", () => {
    expect(ids({ status: "expired" }, "кас")).toEqual(["1"]);
    expect(ids({ group: ADULTS }, "кас")).toEqual([]);
    expect(ids({}, "елкин")).toEqual(["4"]);
  });
});

describe("visibleRows: sorting", () => {
  it("by end date: soonest first, ties by name, never paid last", () => {
    expect(ids({ sort: "ends" })).toEqual(["4", "1", "7", "2", "5", "3"]);
  });

  it("by end date within a filter", () => {
    expect(ids({ sort: "ends", group: ADULTS })).toEqual(["2", "3"]);
    expect(ids({ sort: "ends", status: "expired" })).toEqual(["4", "1"]);
  });
});

describe("filters in the URL", () => {
  it("round-trips", () => {
    const filters = {
      group: KIDS,
      status: "expired" as const,
      coach: COACH_A,
      archived: true,
      sort: "ends" as const,
    };
    const search = filtersToSearch(filters);
    expect(search).toBe(
      `?group=${KIDS}&status=expired&coach=${COACH_A}&archive=1&sort=ends`,
    );
    const params = Object.fromEntries(new URLSearchParams(search));
    expect(parseFilters(params)).toEqual(filters);
  });

  it("defaults give an empty query string", () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("");
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it("ignores unknown and malformed values", () => {
    expect(
      parseFilters({
        group: "Дети",
        status: "paid",
        coach: "1; drop",
        archive: "yes",
        sort: "phone",
      }),
    ).toEqual(DEFAULT_FILTERS);
  });

  it("takes the first of repeated values and the no-group value", () => {
    expect(parseFilters({ group: [NO_ACTIVE_GROUP, KIDS] }).group).toBe(
      NO_ACTIVE_GROUP,
    );
  });
});
