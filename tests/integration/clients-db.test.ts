import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { defined } from "../support/defined";
import { connectLocalDb } from "./db";
import { insertClient, insertPayment, testPhone } from "./support/fixtures";
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

const PERMISSION_DENIED = { code: "42501" };
const NOT_FOUND = { code: "P0002" };
const CHECK_VIOLATION = { code: "23514" };
const INVALID = { code: "22023" };
const TODAY = "2026-11-14";

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

async function archivedGroup(tx: Tx): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.groups (id, name, coach_id, default_price, archived_at)
    values (${id}, ${`Архив ${id.slice(0, 8)}`}, ${SEED_STAFF.admin}, 15000, now())
  `;
  return id;
}

function createClient(
  tx: Tx,
  overrides: Partial<{
    phone: string | null;
    groupId: string | null;
  }> = {},
) {
  return tx<{ id: string }[]>`
    select public.create_client(
      p_last_name => '  Қасымов ',
      p_first_name => 'Алихан',
      p_phone => ${overrides.phone === undefined ? testPhone() : overrides.phone},
      p_started_on => ${TODAY}::date,
      p_group_id => ${overrides.groupId === undefined ? SEED_GROUP : overrides.groupId}::uuid
    ) as id
  `;
}

const deleteClient = (
  tx: Tx,
  id: string,
  lastName: string,
  reason = "duplicate",
) =>
  tx<{ mode: string }[]>`
    select public.delete_client(${id}, ${reason}, ${lastName}) as mode
  `;

describe("criterion 4: a wrong phone is refused by the database", () => {
  it.each(["+79161234567", "87011234567", "+7701123456", "+7 701 123 45 67"])(
    "check constraint refuses %j on insert, via create_client and on update",
    async (phone) => {
      await expect(
        asActor(sql, admin, (tx) =>
          insertClient(tx, { phone, createdBy: SEED_STAFF.admin }),
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
      await expect(
        asActor(sql, admin, (tx) => createClient(tx, { phone })),
      ).rejects.toMatchObject(CHECK_VIOLATION);
      await expect(
        withFixtures(
          admin,
          (tx) => insertClient(tx),
          (tx, id) =>
            tx`update public.clients set phone = ${phone} where id = ${id}`,
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    },
  );

  it("step 21: an adult without a phone (no parent) is refused", async () => {
    await expect(
      asActor(sql, admin, (tx) => createClient(tx, { phone: null })),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});

describe("criterion 5: only the owner deletes a client, the audit row has no personal data", () => {
  it("delete_client refuses an admin and leaves the client", async () => {
    await withFixtures(
      admin,
      (tx) => insertClient(tx, { lastName: "Удаляев" }),
      async (tx, id) => {
        await expect(
          tx.savepoint((sp) => deleteClient(sp, id, "Удаляев")),
        ).rejects.toMatchObject(PERMISSION_DENIED);
        const rows = await tx`select id from public.clients where id = ${id}`;
        expect(rows).toHaveLength(1);
      },
    );
  });

  it("RLS stops an admin who deletes or blanks a client directly", async () => {
    await withFixtures(
      admin,
      (tx) => insertClient(tx),
      async (tx, id) => {
        const deleted =
          await tx`delete from public.clients where id = ${id} returning id`;
        expect(deleted).toHaveLength(0);
        await expect(
          tx.savepoint(
            (sp) =>
              sp`update public.clients set deleted_at = now() where id = ${id}`,
          ),
        ).rejects.toMatchObject(PERMISSION_DENIED);
      },
    );
  });

  it("owner deletes a client without history: the row is gone, the audit row has ids only", async () => {
    await withFixtures(
      owner,
      (tx) => insertClient(tx, { lastName: "Удаляев", phone: "+77009998877" }),
      async (tx, id) => {
        const [row] = await deleteClient(
          tx,
          id,
          "  удаляев ",
          "client_request",
        );
        expect(row?.mode).toBe("deleted");
        expect(
          await tx`select id from public.clients where id = ${id}`,
        ).toHaveLength(0);
        const audit = await auditRows(tx, "client.delete", id, owner);
        expect(audit).toEqual([
          {
            actor_id: SEED_STAFF.owner,
            details: { mode: "deleted", reason: "client_request" },
          },
        ]);
        const text = JSON.stringify(audit);
        expect(text).not.toContain("Удаляев");
        expect(text).not.toContain("9998877");
      },
    );
  });

  it("owner deletes a client with payments: personal data blanked, payments stay", async () => {
    await withFixtures(
      owner,
      async (tx) => {
        const id = await insertClient(tx, {
          lastName: "Платилов",
          phone: "+77009998866",
        });
        await tx`update public.clients set note = 'Брат Платилова', birth_date = '2015-01-01' where id = ${id}`;
        const paymentId = await insertPayment(tx, {
          clientId: id,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
        });
        return { id, paymentId };
      },
      async (tx, { id, paymentId }) => {
        const [row] = await deleteClient(tx, id, "Платилов", "other");
        expect(row?.mode).toBe("anonymized");
        const [client] = await tx`
          select last_name, first_name, phone, note, birth_date, parent_id, group_id,
                 archived_at is not null as archived, deleted_at is not null as deleted
          from public.clients where id = ${id}
        `;
        expect(client).toEqual({
          last_name: "—",
          first_name: "—",
          phone: "+77000000000",
          note: "",
          birth_date: null,
          parent_id: null,
          group_id: null,
          archived: true,
          deleted: true,
        });
        expect(
          await tx`select id from public.payments where id = ${paymentId}`,
        ).toHaveLength(1);
        const audit = await auditRows(tx, "client.delete", id, owner);
        expect(audit[0]?.details).toEqual({
          mode: "anonymized",
          reason: "other",
        });

        // Gone from every screen and from further changes.
        const [screen] = await tx<{ s: { clients: { id: string }[] } }[]>`
          select public.clients_screen(${TODAY}::date) as s
        `;
        expect(defined(screen).s.clients.map((c) => c.id)).not.toContain(id);
        const [card] = await tx`select public.client_screen(${id}) as s`;
        expect(card?.s).toBeNull();
        await expect(
          tx.savepoint((sp) => deleteClient(sp, id, "—")),
        ).rejects.toMatchObject(NOT_FOUND);
        await become(tx, admin);
        const touched =
          await tx`update public.clients set note = 'x' where id = ${id} returning id`;
        expect(touched).toHaveLength(0);
      },
    );
  });

  it("old consents alone are history too: the client is blanked, not removed", async () => {
    // D-10: new consents are no longer recorded, but ones on file from before stay (append-only).
    await withFixtures(
      owner,
      async (tx) => {
        const id = await insertClient(tx, { lastName: "Қасымов" });
        await tx`
          insert into public.consents (client_id, kind, given_on, recorded_by)
          values (${id}, 'messaging', ${TODAY}, ${SEED_STAFF.admin})
        `;
        return id;
      },
      async (tx, id) => {
        const [row] = await deleteClient(tx, id, "Қасымов");
        expect(row?.mode).toBe("anonymized");
        await become(tx, "postgres");
        expect(
          await tx`select kind from public.consents where client_id = ${id}`,
        ).toEqual([{ kind: "messaging" }]);
      },
    );
  });

  it("refuses a wrong last name and a reason outside the list", async () => {
    await withFixtures(
      owner,
      (tx) => insertClient(tx, { lastName: "Верный" }),
      async (tx, id) => {
        await expect(
          tx.savepoint((sp) => deleteClient(sp, id, "Неверный")),
        ).rejects.toMatchObject({
          ...INVALID,
          message: "confirmation_mismatch",
        });
        await expect(
          tx.savepoint((sp) =>
            deleteClient(sp, id, "Верный", "Попросил Верный"),
          ),
        ).rejects.toMatchObject({ ...INVALID, message: "invalid_reason" });
        expect(
          await tx`select id from public.clients where id = ${id}`,
        ).toHaveLength(1);
      },
    );
  });
});

describe("create_client and update_client", () => {
  it("creates the client and one audit row without consents; names are trimmed", async () => {
    await asActor(sql, admin, async (tx) => {
      const id = defined((await createClient(tx))[0]).id;
      const [client] = await tx`
        select last_name, created_by from public.clients where id = ${id}
      `;
      expect(client).toEqual({
        last_name: "Қасымов",
        created_by: SEED_STAFF.admin,
      });
      expect(
        await tx`select id from public.consents where client_id = ${id}`,
      ).toHaveLength(0);
      expect(await auditRows(tx, "client.create", id, admin)).toEqual([
        {
          actor_id: SEED_STAFF.admin,
          details: { group_id: SEED_GROUP, parent_id: null },
        },
      ]);
    });
  });

  it("refuses an archived group for a new client", async () => {
    await withFixtures(admin, archivedGroup, async (tx, groupId) => {
      await expect(createClient(tx, { groupId })).rejects.toMatchObject({
        ...NOT_FOUND,
        message: "group_not_found",
      });
    });
  });

  it("a client may stay in its archived group but not move into another archived one", async () => {
    await withFixtures(
      admin,
      async (tx) => {
        const kept = await archivedGroup(tx);
        const other = await archivedGroup(tx);
        const id = await insertClient(tx);
        await tx`update public.clients set group_id = ${kept} where id = ${id}`;
        return { kept, other, id };
      },
      async (tx, { kept, other, id }) => {
        const update = (sp: Tx, groupId: string) => sp`
          select public.update_client(
            p_client_id => ${id}, p_last_name => 'Новый', p_first_name => 'Клиент',
            p_phone => '+77009990001', p_started_on => '2026-01-10',
            p_group_id => ${groupId}::uuid
          )
        `;
        await update(tx, kept);
        await expect(
          tx.savepoint((sp) => update(sp, other)),
        ).rejects.toMatchObject(NOT_FOUND);
        await update(tx, SEED_GROUP);
        const audit = await auditRows(tx, "client.update", id, admin);
        expect(audit).toHaveLength(2);
        expect(audit[0]?.details).toMatchObject({
          fields: ["last_name", "phone"],
        });
        expect(audit[0]?.details).not.toHaveProperty("consents");
        expect(audit[1]?.details).toEqual({
          fields: ["group_id"],
          from_group_id: kept,
          to_group_id: SEED_GROUP,
          from_parent_id: null,
          to_parent_id: null,
        });
        expect(JSON.stringify(audit)).not.toContain("Новый");
      },
    );
  });

  it.each([
    [
      "create_client",
      (tx: Tx) => tx`
        select public.create_client(
          p_last_name => 'Қасымов', p_first_name => 'Алихан', p_phone => ${testPhone()},
          p_started_on => ${TODAY}::date, p_consents => ${["messaging"]}::text[]
        )
      `,
    ],
    [
      "update_client",
      (tx: Tx) => tx`
        select public.update_client(
          p_client_id => ${randomUUID()}::uuid, p_last_name => 'Қасымов',
          p_first_name => 'Алихан', p_phone => ${testPhone()},
          p_started_on => ${TODAY}::date, p_consents => ${["messaging"]}::text[]
        )
      `,
    ],
    [
      "add_client_consents",
      (tx: Tx) => tx`
        select public.add_client_consents(${randomUUID()}::uuid, ${["messaging"]}::text[])
      `,
    ],
  ] as const)(
    "D-10: %s with consents no longer exists",
    async (_name, call) => {
      await expect(
        rolledBack(sql, async (tx) => {
          await become(tx, admin);
          await call(tx);
        }),
      ).rejects.toMatchObject({ code: "42883" });
    },
  );

  it.each([
    ["owner", owner, SEED_STAFF.owner],
    ["admin", admin, SEED_STAFF.admin],
  ] as const)(
    "D-10: %s cannot record a new consent directly, even in their own name",
    async (_name, actor, recordedBy) => {
      await withFixtures(
        actor,
        (tx) => insertClient(tx),
        async (tx, id) => {
          await expect(
            tx`
            insert into public.consents (client_id, kind, given_on, recorded_by)
            values (${id}, 'messaging', ${TODAY}, ${recordedBy})
          `,
          ).rejects.toMatchObject(PERMISSION_DENIED);
        },
      );
    },
  );
});

describe("archive and bring back", () => {
  it("logs each change once; repeating it changes nothing", async () => {
    await withFixtures(
      admin,
      (tx) => insertClient(tx),
      async (tx, id) => {
        const archive = (value: boolean) =>
          tx<
            { changed: boolean }[]
          >`select public.set_client_archived(${id}, ${value}) as changed`;
        expect((await archive(true))[0]?.changed).toBe(true);
        expect((await archive(true))[0]?.changed).toBe(false);
        expect(await auditRows(tx, "client.archive", id, admin)).toHaveLength(
          1,
        );
        expect((await archive(false))[0]?.changed).toBe(true);
        expect(await auditRows(tx, "client.restore", id, admin)).toHaveLength(
          1,
        );
      },
    );
  });

  it("refuses an unknown client", async () => {
    await expect(
      asActor(
        sql,
        admin,
        (tx) => tx`select public.set_client_archived(${randomUUID()}, true)`,
      ),
    ).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("screens and duplicates", () => {
  it("clients_screen: archived clients are listed (the browser filters), the limit cuts the list", async () => {
    await withFixtures(
      admin,
      (tx) => insertClient(tx, { archived: true }),
      async (tx, id) => {
        const [all] = await tx<
          {
            s: { total: number; clients: { id: string; archived: boolean }[] };
          }[]
        >`
        select public.clients_screen(${TODAY}::date) as s
      `;
        const screen = defined(all).s;
        expect(screen.clients.find((c) => c.id === id)?.archived).toBe(true);
        expect(screen.total).toBe(screen.clients.length);
        const [cut] = await tx<{ s: { total: number; clients: unknown[] } }[]>`
        select public.clients_screen(${TODAY}::date, 10) as s
      `;
        expect(defined(cut).s.clients).toHaveLength(10);
        expect(defined(cut).s.total).toBe(screen.total);
      },
    );
  });

  it("phone_duplicates lists others with the phone, not the client itself", async () => {
    await withFixtures(
      admin,
      async (tx) => {
        const phone = testPhone();
        const first = await insertClient(tx, { phone, lastName: "Первый" });
        const second = await insertClient(tx, { phone, lastName: "Второй" });
        return { phone, first, second };
      },
      async (tx, { phone, first, second }) => {
        const [all] = await tx<{ d: { id: string }[] }[]>`
          select public.phone_duplicates(${phone}) as d
        `;
        expect(
          defined(all)
            .d.map((d) => d.id)
            .sort(),
        ).toEqual([first, second].sort());
        const [others] = await tx<{ d: { id: string; last_name: string }[] }[]>`
          select public.phone_duplicates(${phone}, ${first}) as d
        `;
        expect(defined(others).d).toEqual([
          {
            id: second,
            last_name: "Второй",
            first_name: "Клиент",
            archived: false,
          },
        ]);
      },
    );
  });

  it("anon and an employee without a staff row get nothing", async () => {
    const statements = [
      (tx: Tx) => tx`select public.clients_screen()`,
      (tx: Tx) => tx`select public.client_screen(${randomUUID()})`,
      (tx: Tx) => tx`select public.phone_duplicates('+77000000001')`,
      (tx: Tx) => createClient(tx),
      (tx: Tx) => tx`select public.set_client_archived(${randomUUID()}, true)`,
      (tx: Tx) => deleteClient(tx, randomUUID(), "x"),
    ];
    for (const statement of statements) {
      await expect(asActor(sql, "anon", statement)).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    }
    const stranger: Actor = { userId: randomUUID() };
    const [screen] = await asActor(
      sql,
      stranger,
      (tx) =>
        tx<
          { s: { clients: unknown[] } }[]
        >`select public.clients_screen() as s`,
    );
    expect(defined(screen).s.clients).toEqual([]);
    for (const statement of statements.slice(3)) {
      await expect(asActor(sql, stranger, statement)).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    }
  });
});
