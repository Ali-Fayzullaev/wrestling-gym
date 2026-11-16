import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { parseStaffAccess } from "@/features/auth/access";
import { setMyLocale } from "@/features/locale/service";

import {
  anonClient,
  createTempStaff,
  serviceClient,
  setStaffActive,
  type TempStaff,
} from "../support/staff-accounts";

// Step 16: each employee's interface language (staff.locale) and set_my_locale().
const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);

async function signIn({ email, password }: TempStaff): Promise<Db> {
  const db = createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return db;
}

async function localeOf(staffId: string): Promise<string> {
  const { data, error } = await service
    .from("staff")
    .select("locale")
    .eq("id", staffId)
    .single();
  if (error) throw new Error(`read failed: ${error.code}`);
  return data.locale;
}

let owner: TempStaff;
let admin: TempStaff;
let ownerDb: Db;
let adminDb: Db;

beforeAll(async () => {
  owner = await createTempStaff(connection, "owner");
  admin = await createTempStaff(connection, "admin");
  ownerDb = await signIn(owner);
  adminDb = await signIn(admin);
});

describe("staff.locale", () => {
  it("is Russian for a new employee", async () => {
    expect(await localeOf(admin.id)).toBe("ru");
  });

  it("comes with the role in current_staff_access(), for the proxy", async () => {
    await expect(setMyLocale(adminDb, "uz")).resolves.toEqual({ ok: true });
    const { data } = await adminDb.rpc("current_staff_access");
    expect(parseStaffAccess(data)).toEqual({
      role: "admin",
      mustChangePassword: false,
      locale: "uz",
    });
  });

  it("refuses a language outside the three in the table itself", async () => {
    const { error } = await service
      .from("staff")
      .update({ locale: "en" })
      .eq("id", admin.id);
    expect(error?.code).toBe("23514");
  });
});

describe("set_my_locale()", () => {
  it("lets an admin and an owner change their own language", async () => {
    await expect(setMyLocale(adminDb, "kk")).resolves.toEqual({ ok: true });
    await expect(setMyLocale(ownerDb, "uz")).resolves.toEqual({ ok: true });
    expect(await localeOf(admin.id)).toBe("kk");
    expect(await localeOf(owner.id)).toBe("uz");
  });

  it("changes only the caller's row: there is no way to name another employee", async () => {
    await setMyLocale(adminDb, "ru");
    await setMyLocale(ownerDb, "kk");
    expect(await localeOf(admin.id)).toBe("ru");
    expect(await localeOf(owner.id)).toBe("kk");
  });

  it("refuses a guest", async () => {
    const { error } = await anonClient(connection).rpc("set_my_locale", {
      p_locale: "kk",
    });
    // Not granted to anon at all.
    expect(error?.code).toBe("42501");
  });

  it("refuses a deactivated employee", async () => {
    const leaver = await createTempStaff(connection, "admin");
    const db = await signIn(leaver);
    await setStaffActive(connection, leaver.id, false);
    await expect(setMyLocale(db, "kk")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await localeOf(leaver.id)).toBe("ru");
  });

  it("refuses an employee who still has a temporary password", async () => {
    const newcomer = await createTempStaff(connection, "admin");
    const db = await signIn(newcomer);
    await service
      .from("staff")
      .update({ must_change_password: true })
      .eq("id", newcomer.id);
    await expect(setMyLocale(db, "kk")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("refuses an unknown language", async () => {
    const { error } = await adminDb.rpc("set_my_locale", { p_locale: "en" });
    expect(error?.code).toBe("22023");
    const { error: nullError } = await adminDb.rpc("set_my_locale", {
      // @ts-expect-error null is what a broken client could send
      p_locale: null,
    });
    expect(nullError).not.toBeNull();
  });

  it("does not let an employee write the column through the table", async () => {
    // The admin has no update policy on staff; the owner's covers other columns only.
    await adminDb.from("staff").update({ locale: "uz" }).eq("id", admin.id);
    const { error } = await ownerDb
      .from("staff")
      .update({ locale: "uz" })
      .eq("id", admin.id);
    expect(error?.code).toBe("42501");
    expect(await localeOf(admin.id)).toBe("ru");
  });

  it("gives the same result when two requests race", async () => {
    const results = await Promise.all([
      setMyLocale(adminDb, "kk"),
      setMyLocale(adminDb, "uz"),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(["kk", "uz"]).toContain(await localeOf(admin.id));
  });
});
