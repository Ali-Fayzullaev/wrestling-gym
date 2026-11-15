import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, inject, it } from "vitest";

import { bootstrapOwner } from "@/features/staff/bootstrap";

import { serviceClient } from "../support/staff-accounts";
import { connectLocalDb } from "./db";
import {
  admin,
  asActor,
  become,
  owner,
  rolledBack,
  SEED_STAFF,
  type Actor,
  type Tx,
} from "./support/roles";

const sql = connectLocalDb();
const service = serviceClient({
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
});

afterAll(async () => {
  await sql.end();
});

/**
 * Inside the caller's transaction only: the seed staff are referenced by payments and the journal
 * (on delete restrict), so the foreign-key triggers are paused for this one delete. The rollback
 * restores everything.
 */
async function emptyStaffTable(tx: Tx): Promise<void> {
  await become(tx, "postgres");
  await tx`set local session_replication_role = replica`;
  await tx`delete from public.staff`;
  await tx`set local session_replication_role = origin`;
}

function callBootstrap(tx: Tx, id: string) {
  return tx`select public.bootstrap_owner(${id}::uuid, ${"  Первый Владелец  "})`;
}

describe("bootstrap_owner in the database", () => {
  it("service_role creates the first owner of an empty staff table, with a journal entry", async () => {
    const result = await rolledBack(sql, async (tx) => {
      await emptyStaffTable(tx);
      await become(tx, "service_role");
      await callBootstrap(tx, SEED_STAFF.owner);
      const staff =
        await tx`select id, full_name, role, active from public.staff`;
      const journal = await tx`
        select actor_id, action, entity, entity_id, details from public.audit_log
        where entity_id = ${SEED_STAFF.owner} and action = 'staff.invite'`;
      return { staff, journal };
    });
    expect(result.staff).toEqual([
      {
        id: SEED_STAFF.owner,
        full_name: "Первый Владелец",
        role: "owner",
        active: true,
      },
    ]);
    expect(result.journal).toEqual([
      {
        actor_id: null,
        action: "staff.invite",
        entity: "staff",
        entity_id: SEED_STAFF.owner,
        details: { role: "owner" },
      },
    ]);
  });

  it("a second call is refused once the first owner exists", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        await emptyStaffTable(tx);
        await become(tx, "service_role");
        await callBootstrap(tx, SEED_STAFF.owner);
        await callBootstrap(tx, SEED_STAFF.admin);
      }),
    ).rejects.toMatchObject({ code: "P0001", message: "already_bootstrapped" });
  });

  it("service_role is refused while any employee exists", async () => {
    await expect(
      asActor(sql, "service_role", (tx) => callBootstrap(tx, randomUUID())),
    ).rejects.toMatchObject({ code: "P0001", message: "already_bootstrapped" });
  });

  const OTHER_ROLES: [string, Actor][] = [
    ["owner", owner],
    ["admin", admin],
    ["anon", "anon"],
  ];

  it.each(OTHER_ROLES)(
    "%s may not call it, even on an empty staff table",
    async (_name, actor) => {
      await expect(
        rolledBack(sql, async (tx) => {
          await emptyStaffTable(tx);
          await become(tx, actor);
          await callBootstrap(tx, SEED_STAFF.owner);
        }),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );
});

describe("bootstrapOwner (the create-owner script)", () => {
  it("refuses on a database with staff and sends no invitation", async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const result = await bootstrapOwner(service, {
      email,
      fullName: "Второй Владелец",
      redirectTo: "http://127.0.0.1:3100/auth/confirm",
    });
    expect(result).toEqual({ ok: false, error: "already_bootstrapped" });

    const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain(email);
  });
});
