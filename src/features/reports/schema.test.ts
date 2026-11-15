import { describe, expect, it } from "vitest";

import { exportQuerySchema } from "./schema";

describe("exportQuerySchema", () => {
  it("accepts payments of a month and all clients, in either format", () => {
    expect(
      exportQuerySchema.parse({
        data: "payments",
        format: "xlsx",
        month: "2026-11",
      }),
    ).toEqual({ data: "payments", format: "xlsx", month: "2026-11" });
    expect(exportQuerySchema.parse({ data: "clients", format: "csv" })).toEqual(
      {
        data: "clients",
        format: "csv",
      },
    );
  });

  it("drops unknown fields", () => {
    expect(
      exportQuerySchema.parse({
        data: "clients",
        format: "csv",
        phone: "+77000000001",
      }),
    ).toEqual({ data: "clients", format: "csv" });
  });

  it.each([
    { data: "payments", format: "xlsx" },
    { data: "payments", format: "xlsx", month: "2026-13" },
    { data: "payments", format: "xlsx", month: "2026-11-01" },
    { data: "clients", format: "pdf" },
    { data: "staff", format: "csv" },
    {},
  ])("refuses %j", (query) => {
    expect(exportQuerySchema.safeParse(query).success).toBe(false);
  });
});
