import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import {
  authorizeStaff,
  requestPasswordReset,
  signIn,
  updatePassword,
} from "@/features/auth/service";

import {
  anonClient,
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
  setStaffActive,
  type TempStaff,
} from "../support/staff-accounts";
import { connectLocalDb } from "./db";
import { SEED_STAFF } from "./support/roles";

const sql = connectLocalDb();
const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const admin = serviceClient(connection);

afterAll(async () => {
  await sql.end();
});

/** Each call is a separate "browser" and a separate client address. */
function deps() {
  return { db: anonClient(connection), admin };
}

async function signedInAs(email: string, password: string): Promise<Db> {
  const db = anonClient(connection);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return db;
}

describe("authorizeStaff", () => {
  it("returns the owner as actor for owner-only access", async () => {
    const db = await signedInAs(SEED_EMAILS.owner, SEED_PASSWORD);
    await expect(authorizeStaff(db, ["owner"])).resolves.toEqual({
      ok: true,
      actor: { id: SEED_STAFF.owner, role: "owner" },
    });
  });

  it("refuses an admin where only the owner is allowed", async () => {
    const db = await signedInAs(SEED_EMAILS.admin, SEED_PASSWORD);
    await expect(authorizeStaff(db, ["owner"])).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
    await expect(authorizeStaff(db, ["owner", "admin"])).resolves.toEqual({
      ok: true,
      actor: { id: SEED_STAFF.admin, role: "admin" },
    });
  });

  it("refuses a caller without a session", async () => {
    await expect(
      authorizeStaff(anonClient(connection), ["owner", "admin"]),
    ).resolves.toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("refuses a deactivated employee on the next call with the same session", async () => {
    const staff = await createTempStaff(connection, "admin");
    const db = await signedInAs(staff.email, staff.password);
    expect((await authorizeStaff(db, ["admin"])).ok).toBe(true);

    await setStaffActive(connection, staff.id, false);
    await expect(authorizeStaff(db, ["owner", "admin"])).resolves.toEqual({
      ok: false,
      reason: "inactive",
    });
  });
});

describe("signIn", () => {
  it("signs in an admin, records staff.login and keeps the session", async () => {
    const { db } = deps();
    const result = await signIn({ db, admin }, new Date(), {
      email: SEED_EMAILS.admin,
      password: SEED_PASSWORD,
      ip: randomUUID(),
    });
    expect(result).toEqual({
      ok: true,
      actor: { id: SEED_STAFF.admin, role: "admin" },
    });
    expect((await authorizeStaff(db, ["admin"])).ok).toBe(true);

    // Admins cannot read the audit log, so check it directly: the row is written without returning.
    const rows = await sql<
      { action: string; entity: string; details: unknown }[]
    >`
      select action, entity, details from public.audit_log
      where actor_id = ${SEED_STAFF.admin} and action = 'staff.login'
        and created_at > now() - interval '1 minute'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toEqual({
      action: "staff.login",
      entity: "staff",
      details: {},
    });
  });

  it("answers a wrong password and an unknown email identically", async () => {
    const wrongPassword = await signIn(deps(), new Date(), {
      email: SEED_EMAILS.owner,
      password: "not-the-password",
      ip: randomUUID(),
    });
    const unknownEmail = await signIn(deps(), new Date(), {
      email: `${randomUUID()}@example.test`,
      password: "not-the-password",
      ip: randomUUID(),
    });
    expect(wrongPassword).toEqual({ ok: false, error: "invalid_credentials" });
    expect(unknownEmail).toEqual(wrongPassword);
  });

  it("refuses a deactivated employee and leaves no session behind", async () => {
    const staff = await createTempStaff(connection, "admin");
    await setStaffActive(connection, staff.id, false);
    const { db } = deps();
    const result = await signIn({ db, admin }, new Date(), {
      email: staff.email,
      password: staff.password,
      ip: randomUUID(),
    });
    expect(result).toEqual({ ok: false, error: "access_disabled" });
    expect((await authorizeStaff(db, ["admin"])).ok).toBe(false);
  });

  it("blocks the 6th attempt for an email even with the right password", async () => {
    const staff = await createTempStaff(connection, "admin");
    const now = new Date();
    for (let i = 0; i < 5; i += 1) {
      const result = await signIn(deps(), now, {
        email: staff.email,
        password: "wrong-password",
        ip: randomUUID(),
      });
      expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    }
    const blocked = await signIn(deps(), now, {
      email: staff.email,
      password: staff.password,
      ip: randomUUID(),
    });
    expect(blocked).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterMinutes: 15,
    });
  });

  it("lets through at most 5 of 8 parallel wrong attempts on one email", async () => {
    const email = `${randomUUID()}@example.test`;
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        signIn(deps(), now, {
          email,
          password: "wrong-password",
          ip: randomUUID(),
        }),
      ),
    );
    const errors = results.map((result) => (result.ok ? "ok" : result.error));
    expect(
      errors.filter((error) => error === "invalid_credentials"),
    ).toHaveLength(5);
    expect(errors.filter((error) => error === "rate_limited")).toHaveLength(3);
  });
});

describe("when the throttle ledger is unreachable", () => {
  // A service client with a wrong key: every RPC fails, as during a database restart.
  const brokenAdmin = serviceClient({ ...connection, secretKey: "not-a-key" });

  it("signIn answers unavailable instead of throwing", async () => {
    await expect(
      signIn({ db: anonClient(connection), admin: brokenAdmin }, new Date(), {
        email: SEED_EMAILS.admin,
        password: SEED_PASSWORD,
        ip: randomUUID(),
      }),
    ).resolves.toEqual({ ok: false, error: "unavailable" });
  });

  it("requestPasswordReset answers unavailable instead of throwing", async () => {
    await expect(
      requestPasswordReset(
        { db: anonClient(connection), admin: brokenAdmin },
        new Date(),
        {
          email: SEED_EMAILS.admin,
          ip: randomUUID(),
          redirectTo: "http://127.0.0.1:3100/auth/confirm",
        },
      ),
    ).resolves.toEqual({ ok: false, error: "unavailable" });
  });
});

describe("requestPasswordReset", () => {
  it("reports success for an unknown email", async () => {
    await expect(
      requestPasswordReset(deps(), new Date(), {
        email: `${randomUUID()}@example.test`,
        ip: randomUUID(),
        redirectTo: "http://127.0.0.1:3100/auth/confirm",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("stays silent on the per-email limit and reports the per-IP limit", async () => {
    const now = new Date();
    const email = `${randomUUID()}@example.test`;
    for (let i = 0; i < 4; i += 1) {
      await expect(
        requestPasswordReset(deps(), now, {
          email,
          ip: randomUUID(),
          redirectTo: "http://127.0.0.1:3100/auth/confirm",
        }),
      ).resolves.toEqual({ ok: true });
    }

    const ip = randomUUID();
    for (let i = 0; i < 10; i += 1) {
      await requestPasswordReset(deps(), now, {
        email: `${randomUUID()}@example.test`,
        ip,
        redirectTo: "http://127.0.0.1:3100/auth/confirm",
      });
    }
    await expect(
      requestPasswordReset(deps(), now, {
        email: `${randomUUID()}@example.test`,
        ip,
        redirectTo: "http://127.0.0.1:3100/auth/confirm",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterMinutes: 15,
    });
  });
});

describe("updatePassword", () => {
  let staff: TempStaff;

  beforeAll(async () => {
    staff = await createTempStaff(connection, "admin");
  });

  it("changes the password and audits it", async () => {
    const db = await signedInAs(staff.email, staff.password);
    const actor = { id: staff.id, role: "admin" as const };
    const newPassword = `new-${randomUUID()}`;

    await expect(updatePassword(db, actor, newPassword)).resolves.toEqual({
      ok: true,
    });
    await expect(signedInAs(staff.email, newPassword)).resolves.toBeDefined();
    await expect(signedInAs(staff.email, staff.password)).rejects.toThrow();

    const rows = await sql`
      select 1 from public.audit_log
      where actor_id = ${staff.id} and action = 'staff.password_change'
    `;
    expect(rows).toHaveLength(1);
    staff = { ...staff, password: newPassword };
  });

  it("refuses to set the same password again", async () => {
    const db = await signedInAs(staff.email, staff.password);
    await expect(
      updatePassword(db, { id: staff.id, role: "admin" }, staff.password),
    ).resolves.toEqual({ ok: false, error: "same_password" });
  });
});
