import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { defined } from "../support/defined";
import { connectLocalDb } from "./db";
import { insertClient, insertPayment } from "./support/fixtures";
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

afterAll(async () => {
  await sql.end();
});

const PERMISSION_DENIED = { code: "42501" };
const NOT_FOUND = { code: "P0002" };
const SCHEDULE = JSON.stringify([{ day: 1, start: "09:00", end: "10:00" }]);

/** A group created by the migration owner, outside any policy. */
async function newGroup(
  tx: Tx,
  options: { capacity?: number | null; archived?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.groups (id, name, coach_id, default_price, capacity, archived_at)
    values (
      ${id}, ${`Тест ${id.slice(0, 8)}`}, ${SEED_STAFF.admin}, 15000,
      ${options.capacity === undefined ? 30 : options.capacity},
      ${options.archived ? new Date() : null}
    )
  `;
  return id;
}

async function newClientIn(
  tx: Tx,
  groupId: string,
  options: { archived?: boolean } = {},
): Promise<string> {
  const id = await insertClient(tx, { archived: options.archived });
  await tx`update public.clients set group_id = ${groupId} where id = ${id}`;
  return id;
}

/** Fixtures as postgres, then the rest of the transaction as `actor`. */
function withFixtures<T>(
  actor: Actor,
  setup: (tx: Tx) => Promise<T>,
  run: (tx: Tx, fixtures: T) => Promise<unknown>,
) {
  return rolledBack(sql, async (tx) => {
    await become(tx, "postgres");
    const fixtures = await setup(tx);
    await become(tx, actor);
    return run(tx, fixtures);
  });
}

async function groupOf(tx: Tx, clientId: string): Promise<string | null> {
  const [row] = await tx<{ group_id: string | null }[]>`
    select group_id from public.clients where id = ${clientId}
  `;
  return row?.group_id ?? null;
}

/** Audit rows read as postgres (admins may write but not read the log), then back to `actor`. */
async function auditRows(
  tx: Tx,
  action: string,
  entityId: string,
  actor: Actor,
) {
  await become(tx, "postgres");
  const rows = await tx<
    { actor_id: string; details: Record<string, unknown> }[]
  >`
    select actor_id, details from public.audit_log
    where action = ${action} and entity_id = ${entityId}
  `;
  await become(tx, actor);
  return rows;
}

const createGroup = (tx: Tx) => tx<{ id: string }[]>`
  select public.create_group('Новая', ${SEED_STAFF.admin}, ${SCHEDULE}::text::jsonb, 15000, 20) as id
`;

describe("criterion 1: an admin cannot create, change or archive a group", () => {
  it("create_group refuses an admin and an employee without a role", async () => {
    await expect(asActor(sql, admin, createGroup)).rejects.toMatchObject(
      PERMISSION_DENIED,
    );
    await expect(
      asActor(sql, { userId: randomUUID() }, createGroup),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("update_group and archive_group refuse an admin and change nothing", async () => {
    await withFixtures(admin, newGroup, async (tx, groupId) => {
      await expect(
        tx.savepoint(
          (sp) => sp`
            select public.update_group(
              ${groupId}, 'Чужое имя', ${SEED_STAFF.admin}, '[]'::jsonb, 1, null
            )
          `,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
      await expect(
        tx.savepoint(
          (sp) => sp`select * from public.archive_group(${groupId}, true)`,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
      const [row] = await tx<{ name: string; archived_at: Date | null }[]>`
        select name, archived_at from public.groups where id = ${groupId}
      `;
      expect(row?.name).not.toBe("Чужое имя");
      expect(row?.archived_at).toBeNull();
    });
  });

  it("RLS alone stops an admin who skips the functions", async () => {
    await withFixtures(admin, newGroup, async (tx, groupId) => {
      const touched = await tx`
        update public.groups set archived_at = now(), name = 'Чужое имя'
        where id = ${groupId} returning id
      `;
      expect(touched).toHaveLength(0);
      await expect(
        tx.savepoint(
          (sp) => sp`
            insert into public.groups (name, coach_id, default_price)
            values ('Обход', ${SEED_STAFF.admin}, 100)
          `,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });

  it("anon cannot call any group function", async () => {
    for (const statement of [
      (tx: Tx) => tx`select public.groups_screen()`,
      (tx: Tx) => tx`select public.group_screen(${randomUUID()})`,
      createGroup,
      (tx: Tx) =>
        tx`select * from public.move_clients(${[randomUUID()]}, ${randomUUID()})`,
    ]) {
      await expect(asActor(sql, "anon", statement)).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    }
  });
});

describe("owner changes groups, with an audit row in the same transaction", () => {
  it("create_group trims the name and logs group.create", async () => {
    await asActor(sql, owner, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select public.create_group('  Утренняя  ', ${SEED_STAFF.admin}, ${SCHEDULE}::text::jsonb, 18000) as id
      `;
      const id = defined(row).id;
      const [group] = await tx<{ name: string; capacity: number | null }[]>`
        select name, capacity from public.groups where id = ${id}
      `;
      expect(group).toEqual({ name: "Утренняя", capacity: null });
      expect(await auditRows(tx, "group.create", id, owner)).toEqual([
        { actor_id: SEED_STAFF.owner, details: {} },
      ]);
    });
  });

  it("create_group refuses a deactivated coach", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, "postgres");
      await tx`update public.staff set active = false where id = ${SEED_STAFF.otherAdmin}`;
      await become(tx, owner);
      await expect(
        tx`select public.create_group('Х', ${SEED_STAFF.otherAdmin}, '[]'::jsonb, 100)`,
      ).rejects.toMatchObject(NOT_FOUND);
    });
  });

  it("update_group logs the names of changed fields only, never values", async () => {
    await withFixtures(owner, newGroup, async (tx, groupId) => {
      await tx`
        select public.update_group(
          ${groupId}, 'Новое имя', ${SEED_STAFF.admin}, '[]'::jsonb, 17000, 30
        )
      `;
      const rows = await auditRows(tx, "group.update", groupId, owner);
      expect(rows).toEqual([
        {
          actor_id: SEED_STAFF.owner,
          details: { fields: ["name", "default_price"] },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain("Новое имя");
    });
  });

  it("update_group refuses an archived group", async () => {
    await withFixtures(
      owner,
      (tx) => newGroup(tx, { archived: true }),
      async (tx, groupId) => {
        await expect(
          tx`select public.update_group(${groupId}, 'Х', ${SEED_STAFF.admin}, '[]'::jsonb, 1)`,
        ).rejects.toMatchObject(NOT_FOUND);
      },
    );
  });

  it("a new price does not change recorded payments", async () => {
    await withFixtures(
      owner,
      async (tx) => {
        const groupId = await newGroup(tx);
        const clientId = await newClientIn(tx, groupId);
        const paymentId = await insertPayment(tx, {
          clientId,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          amount: 15000,
        });
        return { groupId, paymentId };
      },
      async (tx, { groupId, paymentId }) => {
        await tx`
          select public.update_group(${groupId}, 'Х', ${SEED_STAFF.admin}, '[]'::jsonb, 25000, 30)
        `;
        const [payment] = await tx<{ amount: number }[]>`
          select amount from public.payments where id = ${paymentId}
        `;
        expect(payment?.amount).toBe(15000);
      },
    );
  });
});

describe("archive_group", () => {
  it("archives an empty group and logs it; a repeat is a no-op", async () => {
    await withFixtures(owner, newGroup, async (tx, groupId) => {
      const [first] =
        await tx`select * from public.archive_group(${groupId}, false)`;
      expect(first).toEqual({ archived: true, active_clients: 0 });
      const [again] =
        await tx`select * from public.archive_group(${groupId}, false)`;
      expect(again).toEqual({ archived: true, active_clients: 0 });
      expect(await auditRows(tx, "group.archive", groupId, owner)).toHaveLength(
        1,
      );
    });
  });

  it("with active clients it waits for the owner's confirmation", async () => {
    await withFixtures(
      owner,
      async (tx) => {
        const groupId = await newGroup(tx);
        await newClientIn(tx, groupId);
        await newClientIn(tx, groupId);
        // Archived clients do not count.
        await newClientIn(tx, groupId, { archived: true });
        return groupId;
      },
      async (tx, groupId) => {
        const [unforced] =
          await tx`select * from public.archive_group(${groupId}, false)`;
        expect(unforced).toEqual({ archived: false, active_clients: 2 });
        const [state] = await tx<{ archived_at: Date | null }[]>`
          select archived_at from public.groups where id = ${groupId}
        `;
        expect(state?.archived_at).toBeNull();

        const [forced] =
          await tx`select * from public.archive_group(${groupId}, true)`;
        expect(forced).toEqual({ archived: true, active_clients: 2 });
        expect(await auditRows(tx, "group.archive", groupId, owner)).toEqual([
          { actor_id: SEED_STAFF.owner, details: { active_clients: 2 } },
        ]);
      },
    );
  });
});

describe("criterion 2: moving clients is all or nothing and audited", () => {
  async function twoGroupsWithClients(tx: Tx) {
    const from = await newGroup(tx);
    const to = await newGroup(tx, { capacity: 1 });
    const clients = [await newClientIn(tx, from), await newClientIn(tx, from)];
    return { from, to, clients };
  }

  it.each([
    ["owner", owner, SEED_STAFF.owner],
    ["admin", admin, SEED_STAFF.admin],
  ] as const)(
    "%s moves two clients, one audit row each",
    async (_, actor, actorId) => {
      await withFixtures(
        actor,
        twoGroupsWithClients,
        async (tx, { from, to, clients }) => {
          const [result] =
            await tx`select * from public.move_clients(${clients}, ${to})`;
          // Over the seat limit of 1: allowed, the screen has warned.
          expect(result).toEqual({
            moved: 2,
            target_members: 2,
            target_capacity: 1,
          });
          for (const clientId of clients) {
            expect(await groupOf(tx, clientId)).toBe(to);
            expect(await auditRows(tx, "client.move", clientId, actor)).toEqual(
              [
                {
                  actor_id: actorId,
                  details: { from_group_id: from, to_group_id: to },
                },
              ],
            );
          }
        },
      );
    },
  );

  it("moves nobody when one of the clients does not exist", async () => {
    await withFixtures(
      admin,
      twoGroupsWithClients,
      async (tx, { from, to, clients }) => {
        await expect(
          tx.savepoint(
            (sp) =>
              sp`select * from public.move_clients(${[...clients, randomUUID()]}, ${to})`,
          ),
        ).rejects.toMatchObject(NOT_FOUND);
        for (const clientId of clients) {
          expect(await groupOf(tx, clientId)).toBe(from);
          expect(
            await auditRows(tx, "client.move", clientId, admin),
          ).toHaveLength(0);
        }
      },
    );
  });

  it("moves nobody when one of the clients is archived", async () => {
    await withFixtures(
      admin,
      async (tx) => {
        const base = await twoGroupsWithClients(tx);
        const archivedClient = await newClientIn(tx, base.from, {
          archived: true,
        });
        return { ...base, archivedClient };
      },
      async (tx, { from, to, clients, archivedClient }) => {
        await expect(
          tx.savepoint(
            (sp) =>
              sp`select * from public.move_clients(${[...clients, archivedClient]}, ${to})`,
          ),
        ).rejects.toMatchObject(NOT_FOUND);
        expect(await groupOf(tx, defined(clients[0]))).toBe(from);
      },
    );
  });

  it("refuses an archived or missing target group and an empty list", async () => {
    await withFixtures(
      admin,
      async (tx) => ({
        ...(await twoGroupsWithClients(tx)),
        archivedTarget: await newGroup(tx, { archived: true }),
      }),
      async (tx, { from, clients, archivedTarget }) => {
        for (const target of [archivedTarget, randomUUID()]) {
          await expect(
            tx.savepoint(
              (sp) =>
                sp`select * from public.move_clients(${clients}, ${target})`,
            ),
          ).rejects.toMatchObject(NOT_FOUND);
        }
        await expect(
          tx.savepoint(
            (sp) =>
              sp`select * from public.move_clients(${[] as string[]}::uuid[], ${from})`,
          ),
        ).rejects.toMatchObject({ code: "22023" });
        expect(await groupOf(tx, defined(clients[0]))).toBe(from);
      },
    );
  });

  it("leaves clients already in the target group alone", async () => {
    await withFixtures(
      admin,
      twoGroupsWithClients,
      async (tx, { from, clients }) => {
        const [result] =
          await tx`select * from public.move_clients(${clients}, ${from})`;
        expect(result).toMatchObject({ moved: 0, target_members: 2 });
        expect(
          await auditRows(tx, "client.move", defined(clients[0]), admin),
        ).toHaveLength(0);
      },
    );
  });
});

describe("parallel transfers of the same clients", () => {
  it("run one after another: both commit, each client ends in one group", async () => {
    const setup = connectLocalDb();
    const first = connectLocalDb();
    const second = connectLocalDb();
    const { from, a, b, clients } = await setup.begin(async (tx) => {
      const fromId = await newGroup(tx);
      return {
        from: fromId,
        a: await newGroup(tx),
        b: await newGroup(tx),
        clients: [await newClientIn(tx, fromId), await newClientIn(tx, fromId)],
      };
    });
    const moveAs = (db: typeof sql, target: string) =>
      db.begin(async (tx) => {
        await become(tx, admin);
        return tx`select * from public.move_clients(${clients}, ${target})`;
      });

    try {
      const results = await Promise.all([moveAs(first, a), moveAs(second, b)]);
      expect(results.map(([row]) => row?.moved)).toEqual([2, 2]);
      const groups = await setup<{ group_id: string }[]>`
        select distinct group_id from public.clients where id = any(${clients})
      `;
      expect(groups).toHaveLength(1);
      expect([a, b]).toContain(groups[0]?.group_id);
      const audit = await setup`
        select 1 from public.audit_log where action = 'client.move' and entity_id = any(${clients})
      `;
      expect(audit).toHaveLength(4);
    } finally {
      await setup`delete from public.clients where id = any(${clients})`;
      await setup`delete from public.groups where id = any(${[from, a, b]})`;
      await Promise.all([setup.end(), first.end(), second.end()]);
    }
  });
});

describe("criterion 3: screen counts match client_status on the seeds", () => {
  type Expected = Record<
    string,
    {
      members: number;
      paid: number;
      expiring: number;
      debtors: number;
      unpaid: number;
    }
  >;

  async function expectedCounts(tx: Tx, today: string): Promise<Expected> {
    const rows = await tx<{ group_id: string; status: string }[]>`
      select c.group_id, cs.status
      from public.client_status(${today}::date) cs
      join public.clients c on c.id = cs.client_id
      where c.archived_at is null and c.group_id is not null
    `;
    const counts: Expected = {};
    for (const { group_id, status } of rows) {
      const c = (counts[group_id] ??= {
        members: 0,
        paid: 0,
        expiring: 0,
        debtors: 0,
        unpaid: 0,
      });
      c.members += 1;
      if (status === "active" || status === "expiring") c.paid += 1;
      if (status === "expiring") c.expiring += 1;
      if (status === "expired") c.debtors += 1;
      if (status === "none") c.unpaid += 1;
    }
    return counts;
  }

  it.each(["2026-11-13", "2026-12-20"])(
    "on %s for every active group",
    async (today) => {
      await asActor(sql, admin, async (tx) => {
        const expected = await expectedCounts(tx, today);
        const [row] = await tx<
          { screen: { groups: (Expected[string] & { id: string })[] } }[]
        >`select public.groups_screen(${today}::date) as screen`;
        const screen = defined(row).screen;
        expect(screen.groups.length).toBeGreaterThanOrEqual(6);
        for (const group of screen.groups) {
          expect(
            {
              members: group.members,
              paid: group.paid,
              expiring: group.expiring,
              debtors: group.debtors,
              unpaid: group.unpaid,
            },
            group.id,
          ).toEqual(
            expected[group.id] ?? {
              members: 0,
              paid: 0,
              expiring: 0,
              debtors: 0,
              unpaid: 0,
            },
          );
        }
      });
    },
  );

  it("group_screen lists exactly the group's active clients, with the same counts", async () => {
    await asActor(sql, admin, async (tx) => {
      const today = "2026-11-13";
      const expected = await expectedCounts(tx, today);
      const groupId = "10000000-0000-4000-8000-000000000001";
      const [row] = await tx<
        {
          screen: {
            group: Expected[string];
            members: { id: string }[];
            targets: { id: string }[];
          };
        }[]
      >`select public.group_screen(${groupId}, ${today}::date) as screen`;
      const screen = defined(row).screen;
      expect(screen.members).toHaveLength(defined(expected[groupId]).members);
      expect(screen.group).toMatchObject(defined(expected[groupId]));
      expect(screen.targets.map((t) => t.id)).not.toContain(groupId);
    });
  });

  it("group_screen is null for a group that does not exist", async () => {
    const [row] = await asActor(
      sql,
      admin,
      (tx) => tx`select public.group_screen(${randomUUID()}) as screen`,
    );
    expect(row?.screen).toBeNull();
  });
});
