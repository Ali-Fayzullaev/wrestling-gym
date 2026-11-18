import { createClient as createSupabase } from "@supabase/supabase-js";
import { describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { authorizeStaff } from "@/features/auth/service";
import { getTodayScreen } from "@/features/today/service";

import { SEED_EMAILS, SEED_PASSWORD } from "../support/staff-accounts";

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
};

/** A signed-in client that counts its requests to the database API (PostgREST). */
async function signedIn(email: string) {
  const counter = { rest: 0 };
  const db: Db = createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/rest/v1/")) counter.rest += 1;
          return fetch(input, init);
        },
      },
    },
  );
  const { error } = await db.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return { db, counter };
}

describe("criterion 5: the Today screen costs at most two database requests", () => {
  it("role check + today_screen", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await getTodayScreen(db, new Date());
    expect(counter.rest).toBeLessThanOrEqual(2);
    expect(screen.remind.flatMap((group) => group.rows)).toHaveLength(
      screen.counts.remindToday,
    );
    expect(screen.paid).toHaveLength(screen.counts.paidToday);
  });

  it("maps rows for the screen: full name, group, price, end date", async () => {
    const { db } = await signedIn(SEED_EMAILS.owner);
    const screen = await getTodayScreen(db, new Date());
    const row = screen.remind[0]?.rows[0];
    expect(row).toBeDefined();
    expect(row?.name).toMatch(/^\S+ \S+/);
    expect(row?.endsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a visitor without a session", async () => {
    const anon: Db = createSupabase<Database>(
      connection.apiUrl,
      connection.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await expect(getTodayScreen(anon, new Date())).rejects.toThrow(
      /today_screen failed/,
    );
  });
});
