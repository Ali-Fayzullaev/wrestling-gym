import { describe, expect, it } from "vitest";

import { auditQueryFromParams, encodeCursor } from "./schema";

const ID = "3f1c2a7e-0000-4000-8000-000000000001";

describe("auditQueryFromParams", () => {
  it("empty form fields mean no filter", () => {
    expect(
      auditQueryFromParams({ staff: "", action: "", from: "", to: "" }),
    ).toEqual({ query: {}, invalid: false });
  });

  it("reads a full filter and a cursor", () => {
    const cursor = encodeCursor({
      createdAt: "2026-11-14T08:00:00.123456+00:00",
      id: ID,
    });
    expect(
      auditQueryFromParams({
        staff: ID,
        action: "report.export",
        from: "2026-11-01",
        to: "2026-11-30",
        cursor,
      }),
    ).toEqual({
      query: {
        staff: ID,
        action: "report.export",
        from: "2026-11-01",
        to: "2026-11-30",
        cursor: { at: "2026-11-14T08:00:00.123456+00:00", id: ID },
      },
      invalid: false,
    });
  });

  it.each([
    [{ staff: "not-a-uuid" }],
    [{ action: "client.teleport" }],
    [{ from: "14.11.2026" }],
    [{ from: "2026-11-30", to: "2026-11-01" }],
    [{ cursor: "garbage" }],
    [{ cursor: `2026-11-14T08:00:00Z_${"x".repeat(36)}` }],
  ])("refuses %o and falls back to the unfiltered journal", (params) => {
    expect(auditQueryFromParams(params)).toEqual({ query: {}, invalid: true });
  });

  it("takes the first of repeated parameters", () => {
    expect(
      auditQueryFromParams({ action: ["payment.create", "client.create"] })
        .query.action,
    ).toBe("payment.create");
  });
});
