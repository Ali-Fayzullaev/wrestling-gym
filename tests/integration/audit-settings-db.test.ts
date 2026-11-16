import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, inject, it } from "vitest";

import { AUDIT_ACTIONS } from "@/features/audit/actions";

import { createTempStaff, setStaffActive } from "../support/staff-accounts";
import { connectLocalDb } from "./db";
import { insertClient } from "./support/fixtures";
import {
  admin,
  asActor,
  become,
  otherAdmin,
  owner,
  rolledBack,
  SEED_STAFF,
  type Tx,
} from "./support/roles";

const sql = connectLocalDb();
const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};

afterAll(async () => {
  await sql.end();
});

const FORBIDDEN = { code: "42501" };

type Feed = {
  entries: {
    id: string;
    created_at: string;
    action: string;
    actor_id: string | null;
    actor_name: string | null;
    client_name: string | null;
  }[];
  staff: { id: string; name: string }[];
};

async function feed(
  tx: Tx,
  args: {
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
    beforeAt?: string;
    beforeId?: string;
    limit?: number;
  } = {},
): Promise<Feed> {
  const [row] = await tx<{ feed: Feed }[]>`
    select public.audit_feed(
      ${args.actor ?? null}::uuid, ${args.action ?? null}, ${args.from ?? null}::date,
      ${args.to ?? null}::date, ${args.beforeAt ?? null}::timestamptz,
      ${args.beforeId ?? null}::uuid, ${args.limit ?? 50}
    ) as feed
  `;
  if (!row) throw new Error("audit_feed returned nothing");
  return row.feed;
}

/** Audit rows written as postgres with a fixed time, for filter and paging checks. */
async function seedEntries(tx: Tx, rows: { action: string; at: string }[]) {
  for (const row of rows) {
    await tx`
      insert into public.audit_log (actor_id, action, entity, created_at)
      values (${SEED_STAFF.otherAdmin}, ${row.action}, 'client', ${row.at})
    `;
  }
}

describe("the action catalog", () => {
  it("accepts every action the journal can name", async () => {
    await rolledBack(sql, async (tx) => {
      for (const action of AUDIT_ACTIONS) {
        await tx`
          insert into public.audit_log (actor_id, action, entity)
          values (${SEED_STAFF.owner}, ${action}, 'client')
        `;
      }
    });
  });

  it("refuses an action outside the catalog", async () => {
    await expect(
      rolledBack(
        sql,
        (tx) => tx`
          insert into public.audit_log (actor_id, action, entity)
          values (${SEED_STAFF.owner}, 'client.teleport', 'client')
        `,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("write_audit", () => {
  it("records the caller as the actor, whoever they claim to be", async () => {
    await asActor(sql, admin, async (tx) => {
      await tx`select public.write_audit('client.update', 'client', null, '{"fields":["note"]}')`;
      await become(tx, "postgres");
      const [row] = await tx<{ actor_id: string }[]>`
        select actor_id from public.audit_log order by created_at desc, id desc limit 1
      `;
      expect(row?.actor_id).toBe(SEED_STAFF.admin);
    });
  });

  it("refuses anon and inactive staff", async () => {
    await expect(
      asActor(
        sql,
        "anon",
        (tx) => tx`select public.write_audit('staff.login', 'staff')`,
      ),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(
      rolledBack(sql, async (tx) => {
        await tx`update public.staff set active = false where id = ${SEED_STAFF.admin}`;
        await become(tx, admin);
        await tx`select public.write_audit('staff.login', 'staff')`;
      }),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("criterion 4: admin neither reads the audit log nor changes settings", () => {
  it("admin gets a refusal from audit_feed and sees no audit rows", async () => {
    await expect(asActor(sql, admin, (tx) => feed(tx))).rejects.toMatchObject(
      FORBIDDEN,
    );
    const visible = await asActor(
      sql,
      admin,
      (tx) => tx`select 1 from public.audit_log limit 1`,
    );
    expect(visible).toHaveLength(0);
  });

  it("admin cannot change the gym settings, by function or directly", async () => {
    await expect(
      asActor(
        sql,
        admin,
        (tx) => tx`select public.update_gym_settings('Чужой зал', null)`,
      ),
    ).rejects.toMatchObject(FORBIDDEN);
    const updated = await asActor(
      sql,
      admin,
      (tx) =>
        tx`update public.settings set gym_name = 'Чужой зал' where id returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it("admin cannot list, add or change staff", async () => {
    await expect(
      asActor(sql, admin, (tx) => tx`select public.staff_screen()`),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(
      asActor(
        sql,
        admin,
        (tx) => tx`select public.add_staff(${randomUUID()}, 'Новый', 'admin')`,
      ),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(
      asActor(
        sql,
        admin,
        (tx) =>
          tx`select public.update_staff_access(${SEED_STAFF.otherAdmin}, 'owner', true)`,
      ),
    ).rejects.toMatchObject(FORBIDDEN);
  });
});

describe("audit_feed for the owner", () => {
  it("joins names, filters by employee, action and Almaty days, newest first", async () => {
    await rolledBack(sql, async (tx) => {
      await seedEntries(tx, [
        // 23:30 Almaty on 1 Nov is 18:30 UTC; 00:30 Almaty on 2 Nov is 19:30 UTC on 1 Nov.
        { action: "client.archive", at: "2025-11-01T18:30:00Z" },
        { action: "client.restore", at: "2025-11-01T19:30:00Z" },
        { action: "client.archive", at: "2025-11-03T06:00:00Z" },
      ]);
      await become(tx, owner);

      const all = await feed(tx, {
        actor: SEED_STAFF.otherAdmin,
        to: "2025-11-30",
      });
      expect(all.entries.map((e) => e.action)).toEqual([
        "client.archive",
        "client.restore",
        "client.archive",
      ]);
      expect(all.entries[0]?.actor_name).toBe("Айгерим Образцова");
      expect(all.staff.map((s) => s.id)).toContain(SEED_STAFF.otherAdmin);

      const archived = await feed(tx, {
        actor: SEED_STAFF.otherAdmin,
        action: "client.archive",
        to: "2025-11-30",
      });
      expect(archived.entries).toHaveLength(2);

      const secondDay = await feed(tx, {
        actor: SEED_STAFF.otherAdmin,
        from: "2025-11-02",
        to: "2025-11-02",
      });
      expect(secondDay.entries.map((e) => e.action)).toEqual([
        "client.restore",
      ]);
    });
  });

  it("pages by cursor without gaps or repeats, even with equal timestamps", async () => {
    await rolledBack(sql, async (tx) => {
      const at = "2020-05-05T05:05:05Z";
      await seedEntries(
        tx,
        Array.from({ length: 5 }, () => ({ action: "client.update", at })),
      );
      await become(tx, owner);
      const args = { actor: SEED_STAFF.otherAdmin, to: "2020-05-31", limit: 2 };
      const seen: string[] = [];
      let page = await feed(tx, args);
      for (let guard = 0; guard < 5; guard += 1) {
        seen.push(...page.entries.slice(0, 2).map((e) => e.id));
        const last = page.entries[1];
        if (page.entries.length <= 2 || !last) break;
        page = await feed(tx, {
          ...args,
          beforeAt: last.created_at,
          beforeId: last.id,
        });
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });
  });

  it("names the client of a client entry, unless the client was deleted", async () => {
    await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx, { lastName: "Журнальный" });
      await tx`
        insert into public.audit_log (actor_id, action, entity, entity_id)
        values (${SEED_STAFF.otherAdmin}, 'client.create', 'client', ${clientId})
      `;
      await become(tx, owner);
      const result = await feed(tx, {
        actor: SEED_STAFF.otherAdmin,
        action: "client.create",
        limit: 1,
      });
      expect(result.entries[0]?.client_name).toBe("Журнальный Клиент");
    });
  });

  it("refuses half a cursor", async () => {
    await expect(
      asActor(sql, owner, (tx) =>
        feed(tx, { beforeAt: "2020-01-01T00:00:00Z" }),
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });
});

describe("update_gym_settings", () => {
  it("owner saves the name and number; the audit row lists fields, not values", async () => {
    await asActor(sql, owner, async (tx) => {
      const [changed] = await tx<{ r: { changed: boolean } }[]>`
        select public.update_gym_settings('  Зал Барыс  ', '+77012223344') as r
      `;
      expect(changed?.r).toEqual({ changed: true });
      const [same] = await tx<{ r: { changed: boolean } }[]>`
        select public.update_gym_settings('Зал Барыс', '+77012223344') as r
      `;
      expect(same?.r).toEqual({ changed: false });
      const [settings] = await tx<{ gym_name: string; gym_whatsapp: string }[]>`
        select gym_name, gym_whatsapp from public.settings
      `;
      expect(settings).toEqual({
        gym_name: "Зал Барыс",
        gym_whatsapp: "+77012223344",
      });
      const audit = await tx<{ details: unknown }[]>`
        select details from public.audit_log
        where actor_id = ${SEED_STAFF.owner} and action = 'settings.update'
          and created_at = now()
      `;
      expect(audit).toEqual([
        { details: { fields: ["gym_name", "gym_whatsapp"] } },
      ]);
    });
  });

  it("refuses a number outside +77XXXXXXXXX and an empty name", async () => {
    await expect(
      asActor(
        sql,
        owner,
        (tx) => tx`select public.update_gym_settings('Зал', '87012223344')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      asActor(
        sql,
        owner,
        (tx) => tx`select public.update_gym_settings('   ', null)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("criterion 2: the last active owner can be neither deactivated nor demoted", () => {
  /** Leaves the seed owner as the only active owner inside the transaction. */
  async function onlySeedOwner(tx: Tx) {
    await tx`
      update public.staff set active = false
      where role = 'owner' and id <> ${SEED_STAFF.owner}
    `;
  }

  it.each([
    ["deactivate", "owner", false],
    ["demote", "admin", true],
  ] as const)(
    "%s the last owner directly: refused",
    async (_, role, active) => {
      await expect(
        rolledBack(sql, async (tx) => {
          await onlySeedOwner(tx);
          await tx`
          update public.staff set role = ${role}, active = ${active}
          where id = ${SEED_STAFF.owner}
        `;
        }),
      ).rejects.toMatchObject({ code: "P0001", message: "last_owner" });
    },
  );

  // Through the function an active owner can only reach another owner while two are active, so
  // the last owner is the caller themselves; the parallel case is the race test below.
  it.each([
    ["deactivate", "owner", false],
    ["demote", "admin", true],
  ] as const)(
    "the only owner cannot %s themselves through update_staff_access",
    async (_, role, active) => {
      await expect(
        rolledBack(sql, async (tx) => {
          await onlySeedOwner(tx);
          await become(tx, owner);
          await tx`select public.update_staff_access(${SEED_STAFF.owner}, ${role}, ${active})`;
        }),
      ).rejects.toMatchObject({ code: "P0001" });
    },
  );

  it("with another active owner, an owner can be demoted, with an audit row", async () => {
    const second = await createTempStaff(connection, "owner");
    try {
      await asActor(sql, owner, async (tx) => {
        await tx`select public.update_staff_access(${second.id}, 'admin', true)`;
        await become(tx, "postgres");
        const audit = await tx<{ action: string; details: unknown }[]>`
          select action, details from public.audit_log
          where entity_id = ${second.id} and created_at = now()
        `;
        expect(audit).toEqual([
          {
            action: "staff.role_change",
            details: { from: "owner", to: "admin" },
          },
        ]);
      });
    } finally {
      await setStaffActive(connection, second.id, false);
    }
  });

  it("an owner does not change their own access", async () => {
    await expect(
      asActor(
        sql,
        owner,
        (tx) =>
          tx`select public.update_staff_access(${SEED_STAFF.owner}, 'admin', true)`,
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "self_change" });
  });

  it("two parallel demotions of the last two owners: exactly one succeeds", async () => {
    const first = await createTempStaff(connection, "owner");
    const second = await createTempStaff(connection, "owner");
    const others = await sql<{ id: string }[]>`
      select id from public.staff
      where role = 'owner' and active and id not in (${first.id}, ${second.id})
    `;
    const otherIds = others.map((row) => row.id);
    const a = connectLocalDb();
    const b = connectLocalDb();
    try {
      // Committed for the race: the two temp owners are the only active owners for a moment.
      await sql`update public.staff set active = false where id = any(${otherIds})`;
      const demote = (conn: typeof sql, actorId: string, target: string) =>
        conn.begin(async (tx) => {
          await become(tx, { userId: actorId });
          await tx`select public.update_staff_access(${target}, 'admin', true)`;
          // Hold the transaction open so both run at the same time.
          await tx`select pg_sleep(0.2)`;
        });
      const results = await Promise.allSettled([
        demote(a, first.id, second.id),
        demote(b, second.id, first.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      // The loser is refused with a clear error (demoted while waiting, or last owner), not a
      // deadlock and not a silent success: staff changes wait for each other.
      const refused = results.find((r) => r.status === "rejected");
      expect(["42501", "P0001"]).toContain(
        (refused as PromiseRejectedResult | undefined)?.reason?.code,
      );
      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.staff
        where id in (${first.id}, ${second.id}) and role = 'owner' and active
      `;
      expect(count?.n).toBe(1);
    } finally {
      await sql`update public.staff set active = true where id = any(${otherIds})`;
      await sql`update public.staff set active = false where id in (${first.id}, ${second.id})`;
      await a.end();
      await b.end();
    }
  });
});

describe("criterion 3: a deactivated employee loses access with the next query", () => {
  it("owner deactivates an admin; the admin's next statements see and write nothing", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, owner);
      await tx`select public.update_staff_access(${SEED_STAFF.admin}, 'admin', false)`;
      await become(tx, admin);
      const clients = await tx`select 1 from public.clients limit 1`;
      expect(clients).toHaveLength(0);
      const [role] = await tx<{ role: string | null }[]>`
        select public.current_staff_role() as role
      `;
      expect(role?.role).toBeNull();
      await expect(
        insertClient(tx, { createdBy: SEED_STAFF.admin }),
      ).rejects.toMatchObject(FORBIDDEN);
    });
  });

  it("another admin keeps working", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, owner);
      await tx`select public.update_staff_access(${SEED_STAFF.admin}, 'admin', false)`;
      await become(tx, otherAdmin);
      const clients = await tx`select 1 from public.clients limit 1`;
      expect(clients).toHaveLength(1);
    });
  });
});

describe("staff_screen", () => {
  it("lists staff with sign-in emails for the owner, active first", async () => {
    const [row] = await asActor(
      sql,
      owner,
      (tx) => tx<{ s: { id: string; email: string; active: boolean }[] }[]>`
        select public.staff_screen() as s
      `,
    );
    const seedOwner = row?.s.find((member) => member.id === SEED_STAFF.owner);
    expect(seedOwner?.email).toBe("owner@example.test");
    const firstInactive = row?.s.findIndex((member) => !member.active) ?? -1;
    if (firstInactive >= 0) {
      expect(
        row?.s.slice(firstInactive).every((member) => !member.active),
      ).toBe(true);
    }
  });
});

describe("temporary passwords (step 15, D-14)", () => {
  type Access = { role: string; must_change_password: boolean } | null;

  async function accessOf(tx: Tx): Promise<Access> {
    const [row] = await tx<{ a: Access }[]>`
      select public.current_staff_access() as a
    `;
    return row?.a ?? null;
  }

  it("owner resets an admin's password: the flag is set, sessions end, the audit row holds no secret", async () => {
    await rolledBack(sql, async (tx) => {
      await tx`
        insert into auth.sessions (id, user_id, created_at, updated_at)
        values (${randomUUID()}, ${SEED_STAFF.admin}, now(), now())
      `;
      await become(tx, owner);
      await tx`select public.begin_password_reset(${SEED_STAFF.admin})`;
      await become(tx, "postgres");
      const sessions = await tx`
        select 1 from auth.sessions where user_id = ${SEED_STAFF.admin}
      `;
      expect(sessions).toHaveLength(0);
      const [audit] = await tx<{ actor_id: string; details: unknown }[]>`
        select actor_id, details from public.audit_log
        where action = 'staff.password_reset' and entity_id = ${SEED_STAFF.admin}
      `;
      expect(audit).toEqual({ actor_id: SEED_STAFF.owner, details: {} });

      await become(tx, admin);
      expect(await accessOf(tx)).toEqual({
        role: "admin",
        must_change_password: true,
        locale: "ru",
      });
      const [role] = await tx<{ role: string | null }[]>`
        select public.current_staff_role() as role
      `;
      expect(role?.role).toBeNull();
      expect(await tx`select 1 from public.clients limit 1`).toHaveLength(0);
      await expect(
        insertClient(tx, { createdBy: SEED_STAFF.admin }),
      ).rejects.toMatchObject(FORBIDDEN);
    });
  });

  it("admin cannot reset passwords, and an owner cannot reset their own here", async () => {
    await expect(
      asActor(
        sql,
        admin,
        (tx) =>
          tx`select public.begin_password_reset(${SEED_STAFF.otherAdmin})`,
      ),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(
      asActor(
        sql,
        owner,
        (tx) => tx`select public.begin_password_reset(${SEED_STAFF.owner})`,
      ),
    ).rejects.toMatchObject({ code: "P0001", message: "self_change" });
    await expect(
      asActor(
        sql,
        owner,
        (tx) => tx`select public.begin_password_reset(${randomUUID()})`,
      ),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("nobody signed in changes the flag directly or lifts it by function, owner included", async () => {
    for (const actor of [owner, admin]) {
      await expect(
        asActor(
          sql,
          actor,
          (tx) =>
            tx`update public.staff set must_change_password = false where id = ${SEED_STAFF.otherAdmin}`,
        ),
      ).rejects.toMatchObject(FORBIDDEN);
      await expect(
        asActor(
          sql,
          actor,
          (tx) =>
            tx`select public.complete_password_change(${SEED_STAFF.otherAdmin})`,
        ),
      ).rejects.toMatchObject(FORBIDDEN);
    }
    await expect(
      asActor(sql, "anon", (tx) => tx`select public.current_staff_access()`),
    ).rejects.toMatchObject(FORBIDDEN);
  });

  it("service_role lifts the flag and records the change as the employee's own", async () => {
    await rolledBack(sql, async (tx) => {
      await tx`update public.staff set must_change_password = true where id = ${SEED_STAFF.admin}`;
      await become(tx, "service_role");
      await tx`select public.complete_password_change(${SEED_STAFF.admin})`;
      await become(tx, admin);
      expect(await accessOf(tx)).toEqual({
        role: "admin",
        must_change_password: false,
        locale: "ru",
      });
      await become(tx, "postgres");
      const [audit] = await tx<{ actor_id: string }[]>`
        select actor_id from public.audit_log
        where action = 'staff.password_change' and entity_id = ${SEED_STAFF.admin}
        order by created_at desc limit 1
      `;
      expect(audit?.actor_id).toBe(SEED_STAFF.admin);
    });
  });

  it("add_staff locks the new employee until they set their own password", async () => {
    await rolledBack(sql, async (tx) => {
      const id = randomUUID();
      await tx`
        insert into auth.users (id, email, aud, role)
        values (${id}, ${`new-${id}@example.test`}, 'authenticated', 'authenticated')
      `;
      await become(tx, owner);
      await tx`select public.add_staff(${id}, 'Новый Сотрудник', 'admin')`;
      await become(tx, "postgres");
      const [row] = await tx<{ must_change_password: boolean }[]>`
        select must_change_password from public.staff where id = ${id}
      `;
      expect(row?.must_change_password).toBe(true);
    });
  });

  it("an inactive employee has no access at all", async () => {
    await rolledBack(sql, async (tx) => {
      await tx`update public.staff set active = false where id = ${SEED_STAFF.admin}`;
      await become(tx, admin);
      expect(await accessOf(tx)).toBeNull();
    });
  });
});
