import { describe, expect, it } from "vitest";

import {
  buildHistory,
  canCancel,
  canReverse,
  type HistoryRow,
} from "./history";

const OWNER = { id: "owner-id", role: "owner" } as const;
const ADMIN = { id: "admin-id", role: "admin" } as const;
const OTHER_ADMIN = { id: "other-admin-id", role: "admin" } as const;
const NOW = new Date("2026-11-14T09:00:00Z");

function row(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    id: "p1",
    kind: "payment",
    amount: 15000,
    method: "cash",
    periodStart: "2026-11-14",
    periodEnd: "2026-12-13",
    reversesId: null,
    reason: null,
    createdAt: "2026-11-14T08:55:00Z",
    createdBy: ADMIN.id,
    createdByName: "Админ",
    ...overrides,
  };
}

describe("buildHistory", () => {
  it("attaches each reversal to the payment it cancels, newest payment first", () => {
    const old = row({ id: "old", createdAt: "2026-10-14T08:00:00Z" });
    const recent = row({ id: "recent" });
    const reversal = row({
      id: "rev",
      kind: "reversal",
      amount: -15000,
      reversesId: "old",
      reason: "Ошибка",
      createdAt: "2026-11-14T08:58:00Z",
    });
    const history = buildHistory([reversal, old, recent]);
    expect(history.map((entry) => entry.payment.id)).toEqual(["recent", "old"]);
    expect(history[0]?.reversal).toBeNull();
    expect(history[1]?.reversal?.id).toBe("rev");
  });

  it("is empty without payments", () => {
    expect(buildHistory([])).toEqual([]);
  });
});

describe("canCancel", () => {
  const [entry] = buildHistory([row({})]);
  if (!entry) throw new Error("fixture");

  it("the author within 10 minutes", () => {
    expect(canCancel(entry, ADMIN, NOW)).toBe(true);
  });

  it("the owner within 10 minutes, another admin never", () => {
    expect(canCancel(entry, OWNER, NOW)).toBe(true);
    expect(canCancel(entry, OTHER_ADMIN, NOW)).toBe(false);
  });

  it("not after 10 minutes", () => {
    const later = new Date("2026-11-14T09:05:00Z");
    expect(canCancel(entry, ADMIN, later)).toBe(false);
    const edge = new Date("2026-11-14T09:04:59Z");
    expect(canCancel(entry, ADMIN, edge)).toBe(true);
  });

  it("not once reversed", () => {
    const [reversed] = buildHistory([
      row({}),
      row({ id: "rev", kind: "reversal", amount: -15000, reversesId: "p1" }),
    ]);
    if (!reversed) throw new Error("fixture");
    expect(canCancel(reversed, ADMIN, NOW)).toBe(false);
  });
});

describe("canReverse", () => {
  it("owner only, once", () => {
    const [entry] = buildHistory([row({})]);
    const [reversed] = buildHistory([
      row({}),
      row({ id: "rev", kind: "reversal", amount: -15000, reversesId: "p1" }),
    ]);
    if (!entry || !reversed) throw new Error("fixture");
    expect(canReverse(entry, OWNER)).toBe(true);
    expect(canReverse(entry, ADMIN)).toBe(false);
    expect(canReverse(reversed, OWNER)).toBe(false);
  });
});

describe("opening balance from the notebook import", () => {
  const balance = row({
    id: "imp",
    kind: "import_balance",
    amount: 0,
    method: null,
    reason: "Перенос из тетради",
    createdBy: OWNER.id,
  });

  it("is listed with the payments", () => {
    const history = buildHistory([
      balance,
      row({ createdAt: "2026-11-14T08:59:00Z" }),
    ]);
    expect(history.map((entry) => entry.payment.id)).toEqual(["p1", "imp"]);
  });

  it("can be neither cancelled nor reversed (no money was received)", () => {
    const [entry] = buildHistory([balance]);
    if (!entry) throw new Error("fixture");
    expect(canCancel(entry, OWNER, NOW)).toBe(false);
    expect(canReverse(entry, OWNER)).toBe(false);
  });
});
