import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { getAuditFeed } from "@/features/audit/service";
import {
  listStaff,
  inviteStaff,
  updateStaffAccess,
} from "@/features/staff/service";

import { defined } from "../support/defined";
import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const REDIRECT = "http://127.0.0.1:3100/auth/confirm";

async function signIn(email: string, password: string): Promise<Db> {
  const db: Db = createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return db;
}

async function authUserExists(email: string): Promise<boolean> {
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  return data.users.some((user) => user.email === email);
}

let ownerDb: Db;
let adminDb: Db;

beforeAll(async () => {
  const owner = await createTempStaff(connection, "owner");
  ownerDb = await signIn(owner.email, owner.password);
  adminDb = await signIn(SEED_EMAILS.admin, SEED_PASSWORD);
});

describe("inviteStaff", () => {
  it("owner invites: the employee is listed as invited, the journal names the invitation", async () => {
    const email = `new-${randomUUID()}@example.test`;
    expect(
      await inviteStaff(
        { db: ownerDb, admin: service },
        {
          email,
          fullName: "Новый Сотрудник",
          role: "admin",
          redirectTo: REDIRECT,
        },
      ),
    ).toEqual({ ok: true });
    const member = (await listStaff(ownerDb)).find((m) => m.email === email);
    expect(member).toMatchObject({
      fullName: "Новый Сотрудник",
      role: "admin",
      active: true,
      invited: true,
    });
    const feed = await getAuditFeed(ownerDb, { action: "staff.invite" }, 5);
    expect(feed.entries.some((e) => e.entityId === member?.id)).toBe(true);
    await updateStaffAccess(ownerDb, {
      staffId: defined(member).id,
      role: "admin",
      active: false,
    });
  });

  it("an admin is refused before Auth creates a user or sends an email", async () => {
    const email = `blocked-${randomUUID()}@example.test`;
    expect(
      await inviteStaff(
        { db: adminDb, admin: service },
        { email, fullName: "Не пройдёт", role: "owner", redirectTo: REDIRECT },
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await authUserExists(email)).toBe(false);
  });

  it("an email already in the system is reported on the email field", async () => {
    expect(
      await inviteStaff(
        { db: ownerDb, admin: service },
        {
          email: SEED_EMAILS.otherAdmin,
          fullName: "Повтор",
          role: "admin",
          redirectTo: REDIRECT,
        },
      ),
    ).toEqual({ ok: false, error: "email_taken", fields: ["email"] });
  });
});

describe("updateStaffAccess", () => {
  it("criterion 3: a deactivated admin's open session reads nothing on the next request", async () => {
    const temp = await createTempStaff(connection, "admin");
    const tempDb = await signIn(temp.email, temp.password);
    const before = await tempDb.from("clients").select("id").limit(1);
    expect(before.data).toHaveLength(1);

    expect(
      await updateStaffAccess(ownerDb, {
        staffId: temp.id,
        role: "admin",
        active: false,
      }),
    ).toEqual({ ok: true });

    const after = await tempDb.from("clients").select("id").limit(1);
    expect(after.data).toEqual([]);
    const { data: role } = await tempDb.rpc("current_staff_role");
    expect(role).toBeNull();
  });

  it("admin cannot change anyone's access", async () => {
    const temp = await createTempStaff(connection, "admin");
    expect(
      await updateStaffAccess(adminDb, {
        staffId: temp.id,
        role: "owner",
        active: true,
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("an unknown employee is not found", async () => {
    expect(
      await updateStaffAccess(ownerDb, {
        staffId: randomUUID(),
        role: "admin",
        active: false,
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});
