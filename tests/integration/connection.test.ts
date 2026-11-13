import { afterAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "./db";

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

describe("local Supabase database", () => {
  it("answers select 1", async () => {
    const rows = await sql<{ one: number }[]>`select 1 as one`;
    expect(rows).toEqual([{ one: 1 }]);
  });

  it("runs Supabase Postgres with the auth schema in place", async () => {
    const rows = await sql<{ exists: boolean }[]>`
      select exists (select 1 from information_schema.schemata where schema_name = 'auth') as exists
    `;
    expect(rows[0]?.exists).toBe(true);
  });
});
