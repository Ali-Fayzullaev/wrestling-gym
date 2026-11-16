import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { getAuditFeed } from "@/features/audit/service";
import { signIn as staffSignIn, updatePassword } from "@/features/auth/service";
import {
  addStaff,
  listStaff,
  resetStaffPassword,
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
const tempPassword = () => `temp-${randomUUID()}`;

function signInClient(): Db {
  return createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function signIn(email: string, password: string): Promise<Db> {
  const db = signInClient();
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

async function canSignIn(email: string, password: string): Promise<boolean> {
  return signIn(email, password).then(
    () => true,
    () => false,
  );
}

async function mustChange(staffId: string): Promise<boolean> {
  const { data } = await service
    .from("staff")
    .select("must_change_password")
    .eq("id", staffId)
    .single();
  return defined(data ?? undefined).must_change_password;
}

describe("addStaff", () => {
  it("criterion 1: owner adds an employee who signs in at once with the temporary password, locked until they change it", async () => {
    const email = `new-${randomUUID()}@example.test`;
    const password = tempPassword();
    expect(
      await addStaff(
        { db: ownerDb, admin: service },
        { email, fullName: "Новый Сотрудник", role: "admin", password },
      ),
    ).toEqual({ ok: true });
    const member = defined(
      (await listStaff(ownerDb)).find((m) => m.email === email),
    );
    expect(member).toMatchObject({
      fullName: "Новый Сотрудник",
      role: "admin",
      active: true,
      mustChangePassword: true,
    });

    const result = await staffSignIn(
      { db: signInClient(), admin: service },
      new Date(),
      { email, password, ip: randomUUID() },
    );
    expect(result).toEqual({
      ok: true,
      actor: { id: member.id, role: "admin" },
      mustChangePassword: true,
    });

    const feed = await getAuditFeed(ownerDb, { action: "staff.invite" }, 5);
    const entry = feed.entries.find((e) => e.entityId === member.id);
    expect(entry?.details).toEqual({ role: "admin" });
    await updateStaffAccess(ownerDb, {
      staffId: member.id,
      role: "admin",
      active: false,
    });
  });

  it("criterion 3: an admin is refused before Auth creates a user", async () => {
    const email = `blocked-${randomUUID()}@example.test`;
    expect(
      await addStaff(
        { db: adminDb, admin: service },
        {
          email,
          fullName: "Не пройдёт",
          role: "owner",
          password: tempPassword(),
        },
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await authUserExists(email)).toBe(false);
  });

  it("an email already in the system is reported on the email field", async () => {
    expect(
      await addStaff(
        { db: ownerDb, admin: service },
        {
          email: SEED_EMAILS.otherAdmin,
          fullName: "Повтор",
          role: "admin",
          password: tempPassword(),
        },
      ),
    ).toEqual({ ok: false, error: "email_taken", fields: ["email"] });
  });

  it("parallel submits add the employee once", async () => {
    const email = `twice-${randomUUID()}@example.test`;
    const input = {
      email,
      fullName: "Двойное Нажатие",
      role: "admin" as const,
      password: tempPassword(),
    };
    const results = await Promise.all(
      [1, 2, 3].map(() => addStaff({ db: ownerDb, admin: service }, input)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // Auth answers a lost race with email_exists or a plain 500; either way it is refused.
    for (const result of results.filter((r) => !r.ok)) {
      expect(["email_taken", "unavailable"]).toContain(
        result.ok ? null : result.error,
      );
    }
    const rows = (await listStaff(ownerDb)).filter((m) => m.email === email);
    expect(rows).toHaveLength(1);
  });

  it("a password Auth refuses leaves no account behind", async () => {
    const email = `weak-${randomUUID()}@example.test`;
    expect(
      await addStaff(
        { db: ownerDb, admin: service },
        // Shorter than the Auth minimum: the schema stops this in the app, Auth stops it here.
        { email, fullName: "Короткий Пароль", role: "admin", password: "1234" },
      ),
    ).toEqual({ ok: false, error: "weak_password", fields: ["password"] });
    expect(await authUserExists(email)).toBe(false);
  });
});

describe("resetStaffPassword", () => {
  it("owner sets a new temporary password: the old one stops working, open sessions end, the lock is back", async () => {
    const temp = await createTempStaff(connection, "admin");
    const tempDb = await signIn(temp.email, temp.password);
    const before = await tempDb.from("clients").select("id").limit(1);
    expect(before.data).toHaveLength(1);

    const password = tempPassword();
    expect(
      await resetStaffPassword(
        { db: ownerDb, admin: service },
        { staffId: temp.id, password },
      ),
    ).toEqual({ ok: true });

    expect(await mustChange(temp.id)).toBe(true);
    expect(await canSignIn(temp.email, temp.password)).toBe(false);
    expect(await canSignIn(temp.email, password)).toBe(true);
    // The old session no longer reaches Auth, and the database gives it nothing either.
    const { error: userError } = await tempDb.auth.getUser();
    expect(userError).not.toBeNull();
    await expect(
      updatePassword(
        { db: tempDb, admin: service },
        { id: temp.id, role: "admin" },
        tempPassword(),
      ),
    ).resolves.toEqual({ ok: false, error: "session_ended" });
    const after = await tempDb.from("clients").select("id").limit(1);
    expect(after.data ?? []).toEqual([]);

    const feed = await getAuditFeed(
      ownerDb,
      { action: "staff.password_reset" },
      5,
    );
    const entry = feed.entries.find((e) => e.entityId === temp.id);
    expect(entry?.details).toEqual({});
    expect(JSON.stringify(feed.entries)).not.toContain(password);
  });

  it("criterion 3: an admin cannot reset anyone's password", async () => {
    const temp = await createTempStaff(connection, "admin");
    expect(
      await resetStaffPassword(
        { db: adminDb, admin: service },
        { staffId: temp.id, password: tempPassword() },
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(await mustChange(temp.id)).toBe(false);
    expect(await canSignIn(temp.email, temp.password)).toBe(true);
  });

  it("an owner does not reset their own password here", async () => {
    const owner = await createTempStaff(connection, "owner");
    const db = await signIn(owner.email, owner.password);
    expect(
      await resetStaffPassword(
        { db, admin: service },
        { staffId: owner.id, password: tempPassword() },
      ),
    ).toEqual({ ok: false, error: "self_change" });
    expect(await canSignIn(owner.email, owner.password)).toBe(true);
  });

  it("an unknown employee is not found and Auth is not called", async () => {
    expect(
      await resetStaffPassword(
        { db: ownerDb, admin: service },
        { staffId: randomUUID(), password: tempPassword() },
      ),
    ).toEqual({ ok: false, error: "not_found" });
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
