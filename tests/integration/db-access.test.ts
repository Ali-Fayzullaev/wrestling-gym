import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, inject, it } from "vitest";

import { connectLocalDb } from "./db";
import { insertClient, insertPayment, templateId } from "./support/fixtures";
import {
  admin,
  asActor,
  become,
  owner,
  rolledBack,
  SEED_GROUP,
  SEED_STAFF,
  type Actor,
  type Tx,
} from "./support/roles";

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TABLES = [
  "staff",
  "groups",
  "clients",
  "consents",
  "payments",
  "reminder_events",
  "message_templates",
  "settings",
  "audit_log",
] as const;

const PERMISSION_DENIED = { code: "42501" };

async function countRows(tx: Tx, table: string): Promise<number> {
  const [row] = await tx.unsafe<{ n: number }[]>(
    `select count(*)::int as n from public.${table}`,
  );
  return row?.n ?? -1;
}

/** Runs a statement as `actor` and reports how many rows it touched. */
async function affected(
  actor: Actor,
  statement: (tx: Tx) => Promise<readonly unknown[]>,
): Promise<number> {
  return asActor(sql, actor, async (tx) => (await statement(tx)).length);
}

describe("criterion 1: anon is refused on every table", () => {
  it.each(TABLES)("anon cannot select from %s", async (table) => {
    await expect(
      asActor(sql, "anon", (tx) => countRows(tx, table)),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it.each(TABLES)("anon cannot insert into %s", async (table) => {
    await expect(
      asActor(sql, "anon", (tx) =>
        tx.unsafe(`insert into public.${table} default values`),
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("anon cannot read client_status_v or call the status functions", async () => {
    await expect(
      asActor(sql, "anon", (tx) => countRows(tx, "client_status_v")),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(
        sql,
        "anon",
        (tx) => tx`select * from public.client_status('2026-01-01')`,
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(
        sql,
        "anon",
        (tx) => tx`select * from public.dashboard_counts('2026-01-01')`,
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(sql, "anon", (tx) => tx`select public.current_staff_role()`),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it.each(TABLES)("the public API refuses anon reads of %s", async (table) => {
    const response = await fetch(
      `${inject("supabaseApiUrl")}/rest/v1/${table}?select=*`,
      {
        headers: { apikey: inject("supabasePublishableKey") },
      },
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });
});

describe("criterion 2: each policy allows its role and refuses the other", () => {
  describe("read access shared by owner and admin", () => {
    const shared = TABLES.filter((t) => t !== "audit_log");

    it.each(shared)("owner and admin both read %s", async (table) => {
      expect(
        await asActor(sql, owner, (tx) => countRows(tx, table)),
      ).toBeGreaterThan(0);
      expect(
        await asActor(sql, admin, (tx) => countRows(tx, table)),
      ).toBeGreaterThan(0);
    });

    it("owner and admin both read client_status_v and dashboard_counts", async () => {
      const allClients = await rolledBack(sql, (tx) =>
        countRows(tx, "clients"),
      );
      for (const actor of [owner, admin]) {
        expect(
          await asActor(sql, actor, (tx) => countRows(tx, "client_status_v")),
        ).toBe(allClients);
        const counts = await asActor(
          sql,
          actor,
          (tx) =>
            tx<{ debtors: number }[]>`select * from public.dashboard_counts()`,
        );
        expect(counts[0]?.debtors).toBeGreaterThan(0);
      }
    });
  });

  describe("audit_log", () => {
    it("owner reads the log, admin sees nothing", async () => {
      expect(
        await asActor(sql, owner, (tx) => countRows(tx, "audit_log")),
      ).toBeGreaterThan(0);
      expect(
        await asActor(sql, admin, (tx) => countRows(tx, "audit_log")),
      ).toBe(0);
    });

    it("both roles write entries in their own name only", async () => {
      for (const [actor, id] of [
        [owner, SEED_STAFF.owner],
        [admin, SEED_STAFF.admin],
      ] as const) {
        // No RETURNING: it would need read access, which admins deliberately lack.
        const inserted = await asActor(
          sql,
          actor,
          async (tx) =>
            (
              await tx`
                insert into public.audit_log (actor_id, action, entity)
                values (${id}, 'client.update', 'client')
              `
            ).count,
        );
        expect(inserted).toBe(1);
      }
      await expect(
        asActor(
          sql,
          admin,
          (tx) => tx`
            insert into public.audit_log (actor_id, action, entity)
            values (${SEED_STAFF.owner}, 'client.update', 'client')
          `,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });

  describe("owner-only writes", () => {
    it("staff: owner inserts and updates, admin cannot", async () => {
      expect(
        await affected(
          owner,
          (tx) =>
            tx`update public.staff set full_name = 'Новое Имя' where id = ${SEED_STAFF.otherAdmin} returning id`,
        ),
      ).toBe(1);
      expect(
        await affected(
          admin,
          (tx) =>
            tx`update public.staff set role = 'owner' where id = ${SEED_STAFF.admin} returning id`,
        ),
      ).toBe(0);

      const newUser = randomUUID();
      const insertStaff = (tx: Tx) => tx`
        insert into public.staff (id, full_name, role) values (${newUser}, 'Новый Сотрудник', 'admin')
        returning id
      `;
      const withAuthUser = async (tx: Tx) => {
        await tx`insert into auth.users (id, instance_id, aud, role) values (${newUser}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`;
      };
      expect(
        await rolledBack(sql, async (tx) => {
          await withAuthUser(tx);
          await become(tx, owner);
          return (await insertStaff(tx)).length;
        }),
      ).toBe(1);
      await expect(
        rolledBack(sql, async (tx) => {
          await withAuthUser(tx);
          await become(tx, admin);
          return insertStaff(tx);
        }),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it("groups: owner inserts and updates, admin cannot", async () => {
      const insertGroup = (tx: Tx) => tx`
        insert into public.groups (name, coach_id, default_price)
        values ('Новая группа', ${SEED_STAFF.admin}, 15000) returning id
      `;
      expect(await affected(owner, insertGroup)).toBe(1);
      await expect(asActor(sql, admin, insertGroup)).rejects.toMatchObject(
        PERMISSION_DENIED,
      );

      const rename = (tx: Tx) =>
        tx`update public.groups set name = 'Переименована' where id = ${SEED_GROUP} returning id`;
      expect(await affected(owner, rename)).toBe(1);
      expect(await affected(admin, rename)).toBe(0);
    });

    it("message_templates: owner edits texts, admin cannot; nobody adds one or changes its kind", async () => {
      // One template per kind, shipped by the migrations (step 09).
      const insertTemplate = (actorId: string) => (tx: Tx) => tx`
        insert into public.message_templates (name, kind, body, updated_by)
        values ('Ещё один', 'overdue', 'Текст', ${actorId}) returning id
      `;
      for (const [actor, actorId] of [
        [owner, SEED_STAFF.owner],
        [admin, SEED_STAFF.admin],
      ] as const) {
        await expect(
          asActor(sql, actor, insertTemplate(actorId)),
        ).rejects.toMatchObject(PERMISSION_DENIED);
      }
      await expect(
        asActor(
          sql,
          owner,
          (tx) => tx`
            update public.message_templates set kind = 'overdue', updated_by = ${SEED_STAFF.owner}
            where kind = 'before_7'
          `,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);

      const edit = (actorId: string) => (tx: Tx) => tx`
        update public.message_templates set body = 'Изменено', updated_by = ${actorId}
        where kind = 'before_7' returning id
      `;
      expect(await affected(owner, edit(SEED_STAFF.owner))).toBe(1);
      expect(await affected(admin, edit(SEED_STAFF.admin))).toBe(0);
    });

    it("settings: owner updates, admin cannot", async () => {
      const update = (tx: Tx) =>
        tx`update public.settings set reminder_days = '{5,2}' returning id`;
      expect(await affected(owner, update)).toBe(1);
      expect(await affected(admin, update)).toBe(0);
    });

    it("settings: nobody inserts a second row or deletes the only one", async () => {
      await expect(
        asActor(
          sql,
          owner,
          (tx) => tx`insert into public.settings default values`,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
      await expect(
        asActor(sql, owner, (tx) => tx`delete from public.settings`),
      ).rejects.toMatchObject(PERMISSION_DENIED);
      await expect(
        rolledBack(
          sql,
          (tx) => tx`insert into public.settings (id) values (false)`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("clients", () => {
    it("both roles insert clients in their own name only", async () => {
      expect(
        await asActor(sql, admin, async (tx) => {
          await insertClient(tx, { createdBy: SEED_STAFF.admin });
          return true;
        }),
      ).toBe(true);
      await expect(
        asActor(sql, admin, (tx) =>
          insertClient(tx, { createdBy: SEED_STAFF.owner }),
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it("both roles update and archive clients", async () => {
      for (const actor of [owner, admin]) {
        const archived = await rolledBack(sql, async (tx) => {
          const id = await insertClient(tx);
          await become(tx, actor);
          const [row] = await tx<{ archived: boolean }[]>`
            update public.clients set archived_at = now(), note = 'Переехал'
            where id = ${id}
            returning archived_at is not null as archived
          `;
          return row?.archived;
        });
        expect(archived).toBe(true);
      }
    });

    it.each(["created_by", "created_at"])(
      "authorship column %s cannot be rewritten",
      async (column) => {
        await expect(
          rolledBack(sql, async (tx) => {
            const id = await insertClient(tx);
            await become(tx, owner);
            await tx.unsafe(
              `update public.clients set ${column} = ${column} where id = $1`,
              [id],
            );
          }),
        ).rejects.toMatchObject(PERMISSION_DENIED);
      },
    );

    it("only the owner deletes a client", async () => {
      const deleteAs = (actor: Actor) =>
        rolledBack(sql, async (tx) => {
          const id = await insertClient(tx);
          await become(tx, actor);
          return (
            await tx`delete from public.clients where id = ${id} returning id`
          ).length;
        });
      expect(await deleteAs(owner)).toBe(1);
      expect(await deleteAs(admin)).toBe(0);
    });
  });

  describe("consents", () => {
    it("both roles record consent in their own name only", async () => {
      const record = (actor: Actor, recordedBy: string) =>
        rolledBack(sql, async (tx) => {
          const id = await insertClient(tx);
          await become(tx, actor);
          return (
            await tx`
              insert into public.consents (client_id, kind, given_on, recorded_by)
              values (${id}, 'messaging', '2026-01-10', ${recordedBy}) returning id
            `
          ).length;
        });
      expect(await record(owner, SEED_STAFF.owner)).toBe(1);
      expect(await record(admin, SEED_STAFF.admin)).toBe(1);
      await expect(record(admin, SEED_STAFF.owner)).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    });
  });

  describe("payments", () => {
    const period = { periodStart: "2026-01-10", periodEnd: "2026-02-09" };

    it("both roles record payments in their own name only", async () => {
      for (const [actor, id] of [
        [owner, SEED_STAFF.owner],
        [admin, SEED_STAFF.admin],
      ] as const) {
        const ok = await rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          await become(tx, actor);
          await insertPayment(tx, { clientId, ...period, createdBy: id });
          return true;
        });
        expect(ok).toBe(true);
      }
      await expect(
        rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          await become(tx, admin);
          await insertPayment(tx, {
            clientId,
            ...period,
            createdBy: SEED_STAFF.owner,
          });
        }),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    /** Original payment by `author` made `minutesAgo`, then a reversal attempt by `actor`. */
    const reverseAs = (
      actor: Actor,
      actorId: string,
      author: string,
      minutesAgo: number,
    ) =>
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const paymentId = await insertPayment(tx, {
          clientId,
          ...period,
          createdBy: author,
          createdAt: new Date(Date.now() - minutesAgo * 60_000),
        });
        await become(tx, actor);
        return (
          await tx`
            insert into public.payments (
              client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
              idempotency_key, created_by
            ) values (
              ${clientId}, 'reversal', -15000, 'cash', ${period.periodStart}, ${period.periodEnd},
              ${paymentId}, 'Отменено сразу', ${randomUUID()}, ${actorId}
            ) returning id
          `
        ).length;
      });

    it("owner reverses any payment at any time", async () => {
      expect(
        await reverseAs(
          owner,
          SEED_STAFF.owner,
          SEED_STAFF.admin,
          60 * 24 * 30,
        ),
      ).toBe(1);
    });

    it("admin cancels own payment within 10 minutes", async () => {
      expect(
        await reverseAs(admin, SEED_STAFF.admin, SEED_STAFF.admin, 9),
      ).toBe(1);
    });

    it("admin cannot reverse own payment after 10 minutes", async () => {
      await expect(
        reverseAs(admin, SEED_STAFF.admin, SEED_STAFF.admin, 11),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it("admin cannot reverse someone else's payment", async () => {
      await expect(
        reverseAs(admin, SEED_STAFF.admin, SEED_STAFF.otherAdmin, 1),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    // The 10-minute window must rest on the server clock: a client-supplied created_at in the
    // future would keep a payment "recent" forever.
    it("signed-in staff cannot choose the created_at of a payment", async () => {
      await expect(
        rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          await become(tx, admin);
          await insertPayment(tx, {
            clientId,
            ...period,
            createdBy: SEED_STAFF.admin,
            createdAt: new Date("2099-01-01T00:00:00Z"),
          });
        }),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });

  describe("server-set timestamps", () => {
    it.each([
      [
        "consents.created_at",
        (tx: Tx, clientId: string) => tx`
          insert into public.consents (client_id, kind, given_on, recorded_by, created_at)
          values (${clientId}, 'messaging', '2026-01-10', ${SEED_STAFF.admin}, '2099-01-01')
        `,
      ],
      [
        "audit_log.created_at",
        (tx: Tx) => tx`
          insert into public.audit_log (actor_id, action, entity, created_at)
          values (${SEED_STAFF.admin}, 'client.update', 'client', '2099-01-01')
        `,
      ],
      [
        "clients.created_at",
        (tx: Tx) => tx`
          insert into public.clients (last_name, first_name, phone, phone_owner, started_on, created_by, created_at)
          values ('Время', 'Клиент', '+77001234567', 'self', '2026-01-10', ${SEED_STAFF.admin}, '2099-01-01')
        `,
      ],
    ] as const)("admin cannot set %s", async (_name, statement) => {
      await expect(
        rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          await become(tx, admin);
          await statement(tx, clientId);
        }),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it("reminder opened_at and marked_sent_at come from the server clock", async () => {
      const row = await rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const paymentId = await insertPayment(tx, {
          clientId,
          periodStart: "2026-01-10",
          periodEnd: "2026-02-09",
        });
        const template = await templateId(tx, "overdue");
        await become(tx, admin);
        await expect(
          tx.savepoint(
            (sp) => sp`
            insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by, opened_at)
            values (${clientId}, ${paymentId}, 'overdue', ${template}, ${SEED_STAFF.admin}, '2099-01-01')
          `,
          ),
        ).rejects.toMatchObject(PERMISSION_DENIED);
        await tx`
          insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
          values (${clientId}, ${paymentId}, 'overdue', ${template}, ${SEED_STAFF.admin})
        `;
        await tx`
          update public.reminder_events
          set status = 'marked_sent', marked_sent_by = ${SEED_STAFF.admin}, marked_sent_at = '2099-01-01'
          where payment_id = ${paymentId}
        `;
        const [event] = await tx<{ future: boolean }[]>`
          select marked_sent_at > now() + interval '1 day' as future
          from public.reminder_events where payment_id = ${paymentId}
        `;
        return event;
      });
      expect(row).toEqual({ future: false });
    });
  });

  describe("reminder_events", () => {
    const openChat = async (
      tx: Tx,
      openedBy: string,
      status = "chat_opened",
    ) => {
      const [payment] = await tx<{ id: string; client_id: string }[]>`
        select id, client_id from public.payments where kind = 'payment' limit 1
      `;
      if (!payment) throw new Error("seed has no payments");
      const template = await templateId(tx, "overdue");
      return tx<{ id: string }[]>`
        insert into public.reminder_events (client_id, payment_id, kind, status, template_id, opened_by)
        values (${payment.client_id}, ${payment.id}, 'overdue', ${status}, ${template}, ${openedBy})
        on conflict (payment_id, kind) do nothing
        returning id
      `;
    };

    it("both roles record an opened chat in their own name only", async () => {
      for (const [actor, id] of [
        [owner, SEED_STAFF.owner],
        [admin, SEED_STAFF.admin],
      ] as const) {
        expect(await affected(actor, (tx) => openChat(tx, id))).toBe(1);
      }
      await expect(
        asActor(sql, admin, (tx) => openChat(tx, SEED_STAFF.owner)),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it("an event cannot be created already marked as sent", async () => {
      await expect(
        asActor(sql, admin, (tx) =>
          openChat(tx, SEED_STAFF.admin, "marked_sent"),
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
    });

    it("both roles mark sent in their own name only", async () => {
      const mark = (actor: Actor, markedBy: string) =>
        rolledBack(sql, async (tx) => {
          const [event] = await openChat(tx, SEED_STAFF.owner);
          await become(tx, actor);
          return (
            await tx`
              update public.reminder_events
              set status = 'marked_sent', marked_sent_by = ${markedBy}, marked_sent_at = now()
              where id = ${event?.id ?? ""} returning id
            `
          ).length;
        });
      expect(await mark(owner, SEED_STAFF.owner)).toBe(1);
      expect(await mark(admin, SEED_STAFF.admin)).toBe(1);
      await expect(mark(admin, SEED_STAFF.otherAdmin)).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    });
  });
});

describe("criterion 8: an employee without an active staff row reads nothing", () => {
  const deactivated = async (tx: Tx) => {
    await tx`update public.staff set active = false where id = ${SEED_STAFF.admin}`;
    await become(tx, admin);
  };

  it.each(TABLES)("deactivated admin reads no rows from %s", async (table) => {
    expect(
      await rolledBack(sql, async (tx) => {
        await deactivated(tx);
        return countRows(tx, table);
      }),
    ).toBe(0);
  });

  it("deactivated admin gets no statuses and zero counters", async () => {
    const result = await rolledBack(sql, async (tx) => {
      await deactivated(tx);
      const statuses = await countRows(tx, "client_status_v");
      const [counts] = await tx`select * from public.dashboard_counts()`;
      const [role] = await tx`select public.current_staff_role() as role`;
      return { statuses, counts, role: role?.role };
    });
    expect(result).toEqual({
      statuses: 0,
      counts: { remind_today: 0, debtors: 0, expiring_week: 0, paid_today: 0 },
      role: null,
    });
  });

  it("deactivated admin cannot write", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        await deactivated(tx);
        await insertClient(tx, { createdBy: SEED_STAFF.admin });
      }),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("a signed-in user who is not staff reads nothing", async () => {
    const stranger: Actor = { userId: randomUUID() };
    for (const table of TABLES) {
      expect(await asActor(sql, stranger, (tx) => countRows(tx, table))).toBe(
        0,
      );
    }
  });

  it("reactivated staff regain access on the next query", async () => {
    const allClients = await rolledBack(sql, (tx) => countRows(tx, "clients"));
    const counts = await rolledBack(sql, async (tx) => {
      await deactivated(tx);
      const before = await countRows(tx, "clients");
      await become(tx, "postgres");
      await tx`update public.staff set active = true where id = ${SEED_STAFF.admin}`;
      await become(tx, admin);
      return { before, after: await countRows(tx, "clients") };
    });
    expect(counts).toEqual({ before: 0, after: allClients });
  });
});
