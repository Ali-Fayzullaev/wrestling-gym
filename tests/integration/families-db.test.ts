import { randomInt, randomUUID } from "node:crypto";

import postgres from "postgres";
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
  type Tx,
} from "./support/roles";

// Step 21 (D-18, D-19): a parent and several children.

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-03-15";
const CHECK_VIOLATION = { code: "23514" };
const PERMISSION_DENIED = { code: "42501" };

/** Phones outside the seed (+7700000…, +7700002…) and outside testPhone() (+77000009…). */
const familyPhone = () => `+7703${String(randomInt(1e7)).padStart(7, "0")}`;

async function insertParent(
  tx: Tx,
  row: {
    name?: string;
    phone?: string;
    locale?: string;
    archived?: boolean;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.parents (id, name, phone, message_locale, archived_at, created_by)
    values (
      ${id}, ${row.name ?? "Айгуль"}, ${row.phone ?? familyPhone()}, ${row.locale ?? "ru"},
      ${row.archived ? new Date("2026-01-01T00:00:00Z") : null}, ${SEED_STAFF.owner}
    )
  `;
  return id;
}

async function insertChild(
  tx: Tx,
  parentId: string,
  firstName: string,
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.clients (
      id, last_name, first_name, phone, parent_id, group_id, started_on, created_by
    ) values (
      ${id}, 'Семейный', ${firstName}, null, ${parentId}, ${SEED_GROUP}, '2026-01-10',
      ${SEED_STAFF.owner}
    )
  `;
  return id;
}

/** A paid subscription ending on `periodEnd`, recorded long ago. */
function paidUntil(tx: Tx, clientId: string, periodEnd: string) {
  return insertPayment(tx, {
    clientId,
    periodStart: "2026-02-16",
    periodEnd,
    createdAt: new Date("2026-02-16T06:00:00Z"),
  });
}

function createChild(
  tx: Tx,
  args: {
    parentId?: string;
    newParent?: Record<string, string>;
    phone?: string;
  },
) {
  return tx<{ id: string }[]>`
    select public.create_client(
      p_last_name => 'Семейный',
      p_first_name => 'Ребёнок',
      p_started_on => ${TODAY}::date,
      p_phone => ${args.phone ?? null},
      p_parent_id => ${args.parentId ?? null}::uuid,
      p_new_parent => ${args.newParent ? tx.json(args.newParent) : null}::jsonb,
      p_group_id => ${SEED_GROUP}::uuid
    ) as id
  `;
}

describe("criterion 1: a child without a phone is saved with a parent", () => {
  it("create_client: an existing parent, no phone of the child's own", async () => {
    const child = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      await become(tx, admin);
      const [row] = await createChild(tx, { parentId });
      const [saved] = await tx`
        select phone, parent_id from public.clients where id = ${row?.id ?? ""}
      `;
      return { saved, parentId };
    });
    expect(child.saved).toEqual({ phone: null, parent_id: child.parentId });
  });

  it("a child may keep a phone of their own", async () => {
    const phone = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      await become(tx, admin);
      const own = familyPhone();
      const [row] = await createChild(tx, { parentId, phone: own });
      const [saved] = await tx<{ phone: string }[]>`
        select phone from public.clients where id = ${row?.id ?? ""}
      `;
      return { own, saved: saved?.phone };
    });
    expect(phone.saved).toBe(phone.own);
  });

  it("an archived or unknown parent is refused; both kinds of parent at once too", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx, { archived: true });
        await become(tx, admin);
        await createChild(tx, { parentId });
      }),
    ).rejects.toMatchObject({ code: "P0002", message: "parent_not_found" });
    await expect(
      asActor(sql, admin, (tx) => createChild(tx, { parentId: randomUUID() })),
    ).rejects.toMatchObject({ code: "P0002", message: "parent_not_found" });
    await expect(
      rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx);
        await become(tx, admin);
        await createChild(tx, {
          parentId,
          newParent: { name: "Ерлан", phone: familyPhone() },
        });
      }),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_parent" });
  });

  it("a new parent with a wrong phone is refused by the database", async () => {
    await expect(
      asActor(sql, admin, (tx) =>
        createChild(tx, { newParent: { name: "Ерлан", phone: "87011234567" } }),
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});

describe("criterion 2: two children of one parent, the phone stored once", () => {
  it("the first child creates the parent, the second picks it", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const phone = familyPhone();
      await become(tx, admin);
      const [first] = await createChild(tx, {
        newParent: { name: " Айгуль ", phone, message_locale: "kk" },
      });
      const [parent] = await tx<{ parent_id: string }[]>`
        select parent_id from public.clients where id = ${first?.id ?? ""}
      `;
      await createChild(tx, { parentId: parent?.parent_id ?? "" });
      const parents = await tx`
        select name, message_locale from public.parents where phone = ${phone}
      `;
      const children = await tx`
        select phone from public.clients where parent_id = ${parent?.parent_id ?? ""}
      `;
      // The audit log is the owner's; read it as postgres.
      await become(tx, "postgres");
      const audit = await tx<{ details: unknown }[]>`
        select details from public.audit_log
        where action = 'parent.create' and entity_id = ${parent?.parent_id ?? ""}
      `;
      return { parents, children, audit, phone };
    });
    expect(result.parents).toEqual([{ name: "Айгуль", message_locale: "kk" }]);
    expect(result.children).toEqual([{ phone: null }, { phone: null }]);
    // Ids only: the audit row never holds the parent's name or phone.
    expect(result.audit).toHaveLength(1);
    expect(JSON.stringify(result.audit)).not.toMatch(/Айгуль|\+770/);
  });
});

type Link = { client_id: string; phone: string; parent_name: string };

async function transfer(tx: Tx, links: Link[]) {
  const [row] = await tx<{ r: { parents: number; children: number } }[]>`
    select public.transfer_legacy_parents(${tx.json(links)}) as r
  `;
  return row?.r;
}

describe("criterion 3: old data moves to parents, nothing is lost", () => {
  it("groups by phone and parent name, moves the phone, keeps payments; a second run changes nothing", async () => {
    const result = await rolledBack(sql, async (tx) => {
      // Old "parent's phone" clients, as the migration found them: own rows with the phone.
      const shared = familyPhone();
      const other = familyPhone();
      const arman = await insertClient(tx, {
        phone: shared,
        messageLocale: "kk",
      });
      const dana = await insertClient(tx, {
        phone: shared,
        messageLocale: "kk",
      });
      const ivan = await insertClient(tx, {
        phone: shared,
        messageLocale: "ru",
      });
      const timur = await insertClient(tx, { phone: other });
      const payment = await paidUntil(tx, arman, "2026-03-20");
      const links: Link[] = [
        { client_id: arman, phone: shared, parent_name: "Айгуль" },
        // Case and spaces do not make another parent.
        { client_id: dana, phone: shared, parent_name: "  айгуль " },
        // The same phone with another name is another parent.
        { client_id: ivan, phone: shared, parent_name: "Ерлан" },
        { client_id: timur, phone: other, parent_name: "Марат" },
      ];
      const counts = async () => {
        const [row] = await tx<{ clients: number; payments: number }[]>`
          select (select count(*)::int from public.clients) as clients,
                 (select count(*)::int from public.payments) as payments
        `;
        return row;
      };
      const before = await counts();
      const first = await transfer(tx, links);
      const again = await transfer(tx, links);
      const after = await counts();
      const children = await tx<
        {
          id: string;
          phone: string | null;
          name: string;
          parent_phone: string;
          locale: string;
        }[]
      >`
        select c.id, c.phone, p.name, p.phone as parent_phone, p.message_locale as locale
        from public.clients c join public.parents p on p.id = c.parent_id
        where c.id in ${tx([arman, dana, ivan, timur])}
      `;
      const [paid] = await tx<{ client_id: string }[]>`
        select client_id from public.payments where id = ${payment}
      `;
      return {
        first,
        again,
        before,
        after,
        children,
        paid,
        arman,
        dana,
        ivan,
        timur,
        shared,
      };
    });
    expect(result.first).toEqual({ parents: 3, children: 4 });
    expect(result.again).toEqual({ parents: 0, children: 0 });
    expect(result.after).toEqual(result.before);
    const byId = new Map(result.children.map((row) => [row.id, row]));
    expect(byId.get(result.arman)).toMatchObject({
      phone: null,
      parent_phone: result.shared,
      locale: "kk",
    });
    // One parent for both spellings; its name is one of them, trimmed.
    expect(byId.get(result.arman)?.name.toLowerCase()).toBe("айгуль");
    expect(byId.get(result.dana)?.name).toBe(byId.get(result.arman)?.name);
    expect(byId.get(result.ivan)?.name).toBe("Ерлан");
    expect(byId.get(result.timur)?.name).toBe("Марат");
    expect(result.paid?.client_id).toBe(result.arman);
  });

  it("is not callable by staff", async () => {
    await expect(
      asActor(sql, owner, (tx) => transfer(tx, [])),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

type FamilyEvent = { client_id: string; created: boolean; payment_id: string };

async function openFamily(
  tx: Tx,
  parentId: string,
  items: { payment_id: string; kind: string }[],
  locale: string | null = null,
): Promise<FamilyEvent[]> {
  const [row] = await tx<{ r: FamilyEvent[] }[]>`
    select public.record_family_reminder_opened(${parentId}, ${tx.json(items)}, ${locale}) as r
  `;
  return row?.r ?? [];
}

/** A parent with two children whose subscriptions end in 7 and 1 days. */
async function familyDueToday(tx: Tx, locale = "kk") {
  const parentId = await insertParent(tx, { locale });
  const arman = await insertChild(tx, parentId, "Арман");
  const dana = await insertChild(tx, parentId, "Дана");
  return {
    parentId,
    arman,
    dana,
    armanPayment: await paidUntil(tx, arman, "2026-03-22"),
    danaPayment: await paidUntil(tx, dana, "2026-03-16"),
  };
}

describe("criterion 4: one message to the parent, chat opened for every child", () => {
  it("records an event per child with the family template in the parent's language; a repeat doubles nothing", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx, "kk");
      const items = [
        { payment_id: f.armanPayment, kind: "before_7" },
        { payment_id: f.danaPayment, kind: "before_1" },
      ];
      await become(tx, admin);
      const first = await openFamily(tx, f.parentId, items);
      const again = await openFamily(tx, f.parentId, items, "uz");
      const events = await tx<
        { client_id: string; kind: string; template_id: string }[]
      >`
        select client_id, kind, template_id from public.reminder_events
        where client_id in ${tx([f.arman, f.dana])} order by kind
      `;
      return {
        f,
        first,
        again,
        events,
        family: await templateId(tx, "family", "kk"),
      };
    });
    expect(result.first.map((e) => e.created)).toEqual([true, true]);
    expect(result.again.map((e) => e.created)).toEqual([false, false]);
    expect(result.events).toEqual([
      {
        client_id: result.f.dana,
        kind: "before_1",
        template_id: result.family,
      },
      {
        client_id: result.f.arman,
        kind: "before_7",
        template_id: result.family,
      },
    ]);
  });

  it("the chosen language picks its family template", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx, "kk");
      await become(tx, owner);
      await openFamily(
        tx,
        f.parentId,
        [
          { payment_id: f.armanPayment, kind: "before_7" },
          { payment_id: f.danaPayment, kind: "before_1" },
        ],
        "uz",
      );
      const templates = await tx<{ template_id: string }[]>`
        select distinct template_id from public.reminder_events
        where client_id in ${tx([f.arman, f.dana])}
      `;
      return { templates, uz: await templateId(tx, "family", "uz") };
    });
    expect(result.templates).toEqual([{ template_id: result.uz }]);
  });

  it("refuses a child of another parent and writes nothing at all", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      const stranger = await insertClient(tx);
      const strangerPayment = await paidUntil(tx, stranger, "2026-03-22");
      await become(tx, admin);
      const error = await tx
        .savepoint((sp) =>
          openFamily(sp, f.parentId, [
            { payment_id: f.armanPayment, kind: "before_7" },
            { payment_id: strangerPayment, kind: "before_7" },
          ]),
        )
        .catch((e: unknown) => e);
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.reminder_events
        where payment_id in ${tx([f.armanPayment, strangerPayment])}
      `;
      return { error, count: count?.n };
    });
    expect(result.error).toMatchObject({
      code: "P0002",
      message: "payment_not_found",
    });
    expect(result.count).toBe(0);
  });

  it("refuses one child only, an unknown kind and a stranger without a role", async () => {
    const attempt = (
      items: { payment_id: string; kind: string }[],
      actor = admin,
    ) =>
      rolledBack(sql, async (tx) => {
        const f = await familyDueToday(tx);
        const real = items.map((item, i) => ({
          ...item,
          payment_id: i === 0 ? f.armanPayment : f.danaPayment,
        }));
        await become(tx, actor);
        return openFamily(tx, f.parentId, real);
      });
    await expect(
      attempt([{ payment_id: "", kind: "before_7" }]),
    ).rejects.toMatchObject({
      code: "22023",
      message: "invalid_items",
    });
    await expect(
      attempt([
        { payment_id: "", kind: "before_7" },
        { payment_id: "", kind: "family" },
      ]),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_kind" });
    await expect(
      attempt(
        [
          { payment_id: "", kind: "before_7" },
          { payment_id: "", kind: "before_1" },
        ],
        { userId: randomUUID() },
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("a child's single reminder defaults to the parent's language", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx, "uz");
      await become(tx, admin);
      const [row] = await tx<{ id: string }[]>`
        select public.reminder_template_for(${f.arman}, 'before_7') as id
      `;
      return { id: row?.id, uz: await templateId(tx, "before_7", "uz") };
    });
    expect(result.id).toBe(result.uz);
  });

  it("parallel clicks from two tabs leave exactly one event per child", async () => {
    // Committed: the parallel sessions must see the same rows. The family template is never
    // removed by any test, so these events block nothing.
    const f = await sql.begin(async (tx) => {
      const parentId = await insertParent(tx, { archived: true });
      const arman = await insertChild(tx, parentId, "Параллельный");
      const dana = await insertChild(tx, parentId, "Параллельная");
      await tx`update public.clients set archived_at = now() where id in ${tx([arman, dana])}`;
      return {
        parentId,
        payments: [
          await paidUntil(tx, arman, "2026-03-22"),
          await paidUntil(tx, dana, "2026-03-16"),
        ],
      };
    });
    const items = [
      { payment_id: f.payments[0] ?? "", kind: "before_7" },
      { payment_id: f.payments[1] ?? "", kind: "before_1" },
    ];
    const dbs = [0, 1, 2].map(() =>
      postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
    );
    try {
      const results = await Promise.all(
        dbs.map((db) =>
          db.begin(async (tx) => {
            await become(tx, admin);
            return openFamily(tx, f.parentId, items);
          }),
        ),
      );
      expect(results.flat().filter((event) => event.created)).toHaveLength(2);
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.reminder_events
      where payment_id in ${sql(f.payments)}
    `;
    expect(count?.n).toBe(2);
  });
});

describe("criterion 5: a payment of one child leaves the other's status alone (D-19)", () => {
  it("only the paid child becomes active", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      const arman = await insertChild(tx, parentId, "Арман");
      const dana = await insertChild(tx, parentId, "Дана");
      await paidUntil(tx, arman, "2026-03-01");
      await paidUntil(tx, dana, "2026-03-01");
      const status = async () =>
        tx<{ client_id: string; status: string }[]>`
          select client_id, status from public.client_status(${TODAY}::date)
          where client_id in ${tx([arman, dana])} order by client_id = ${arman} desc
        `;
      const before = await status();
      await become(tx, admin);
      await tx`
        select public.record_payment(${arman}, 15000, 'cash', ${randomUUID()}::uuid)
      `;
      await become(tx, "postgres");
      return { before, after: await status() };
    });
    expect(result.before.map((r) => r.status)).toEqual(["expired", "expired"]);
    expect(result.after.map((r) => r.status)).toEqual(["active", "expired"]);
  });
});

describe("criterion 6: parents RLS", () => {
  it("anon and a signed-in non-employee read and write nothing", async () => {
    await expect(
      asActor(sql, "anon", (tx) => tx`select count(*) from public.parents`),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(sql, "anon", (tx) => tx`select public.search_parents('Айгуль')`),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    const stranger = await asActor(
      sql,
      { userId: randomUUID() },
      async (tx) => {
        const [row] = await tx<
          { n: number }[]
        >`select count(*)::int as n from public.parents`;
        return row?.n;
      },
    );
    expect(stranger).toBe(0);
    await expect(
      asActor(
        sql,
        { userId: randomUUID() },
        (tx) =>
          tx`insert into public.parents (name, phone) values ('Чужой', ${familyPhone()})`,
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("admin reads and edits a parent but cannot delete one; the owner can", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx, { name: "Удаляемая" });
      await become(tx, admin);
      const seen =
        await tx`select id from public.parents where id = ${parentId}`;
      await tx`
        select public.update_parent(${parentId}, 'Изменённая', ${familyPhone()}, 'kk', '')
      `;
      const byAdmin =
        await tx`delete from public.parents where id = ${parentId} returning id`;
      await become(tx, owner);
      const byOwner =
        await tx`delete from public.parents where id = ${parentId} returning id`;
      return {
        seen: seen.length,
        byAdmin: byAdmin.length,
        byOwner: byOwner.length,
      };
    });
    expect(result).toEqual({ seen: 1, byAdmin: 0, byOwner: 1 });
  });

  it("a parent with children cannot be deleted even by the owner", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx);
        await insertChild(tx, parentId, "Арман");
        await become(tx, owner);
        await tx`delete from public.parents where id = ${parentId}`;
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("nobody moves the authorship or the creation time of a parent", async () => {
    const row = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      await become(tx, admin);
      await expect(
        tx.savepoint(
          (sp) =>
            sp`update public.parents set created_by = ${SEED_STAFF.admin} where id = ${parentId}`,
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED);
      const [saved] =
        await tx`select created_by from public.parents where id = ${parentId}`;
      return saved;
    });
    expect(row).toEqual({ created_by: SEED_STAFF.owner });
  });
});

describe("search_parents and parent_screen", () => {
  it("finds a current parent by name or phone digits; archived ones are left out", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const phone = familyPhone();
      const current = await insertParent(tx, {
        name: "Сауле Поисковая",
        phone,
      });
      await insertChild(tx, current, "Арман");
      await insertParent(tx, { name: "Сауле Поисковая", archived: true });
      await become(tx, admin);
      const search = async (query: string) => {
        const [row] = await tx<{ r: { id: string; children: string[] }[] }[]>`
          select public.search_parents(${query}) as r
        `;
        return row?.r ?? [];
      };
      return {
        current,
        byName: await search("поисковая"),
        byPhone: await search(phone.slice(-7)),
        tooShort: await search("с"),
      };
    });
    expect(result.byName).toEqual([
      expect.objectContaining({ id: result.current, children: ["Арман"] }),
    ]);
    expect(result.byPhone.map((p) => p.id)).toEqual([result.current]);
    expect(result.tooShort).toEqual([]);
  });

  it("the parent's card lists every child with its own status and price", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      await become(tx, admin);
      const [row] = await tx<
        {
          s: {
            children: { first_name: string; status: string; price: number }[];
          };
        }[]
      >`
        select public.parent_screen(${f.parentId}, ${TODAY}::date) as s
      `;
      return row?.s;
    });
    expect(
      screen?.children.map((c) => [c.first_name, c.status, c.price]),
    ).toEqual([
      ["Арман", "expiring", 15000],
      ["Дана", "expiring", 15000],
    ]);
  });

  it("an unknown parent's card is null", async () => {
    const screen = await asActor(sql, admin, async (tx) => {
      const [row] = await tx`select public.parent_screen(${randomUUID()}) as s`;
      return row?.s;
    });
    expect(screen).toBeNull();
  });
});

type ImportRow = {
  line: number;
  last_name: string;
  first_name: string;
  phone: string;
  group_id: null;
  new_group: null;
  ends_on: null;
  message_locale: string;
  parent_name: string | null;
};

describe("criterion 9: the import puts children of one parent together", () => {
  it("rows with the same phone and parent share a new parent; an existing one is reused", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const newPhone = familyPhone();
      const knownPhone = familyPhone();
      const known = await insertParent(tx, {
        name: "Динара",
        phone: knownPhone,
      });
      const row = (
        line: number,
        first: string,
        phone: string,
        parent: string | null,
      ): ImportRow => ({
        line,
        last_name: "Импортная",
        first_name: first,
        phone,
        group_id: null,
        new_group: null,
        ends_on: null,
        message_locale: "uz",
        parent_name: parent,
      });
      await become(tx, owner);
      const [reply] = await tx<
        { r: { created: number; parents_created: number } }[]
      >`
        select public.import_clients(
          ${"a".repeat(64)},
          ${tx.json([
            row(2, "Арман", newPhone, "Айгуль"),
            row(3, "Дана", newPhone, " айгуль"),
            row(4, "Тимур", knownPhone, "динара"),
          ])},
          '[]'::jsonb,
          ${TODAY}::date
        ) as r
      `;
      const children = await tx<
        { first_name: string; phone: string | null; parent_id: string }[]
      >`
        select first_name, phone, parent_id from public.clients
        where last_name = 'Импортная' order by first_name
      `;
      const created = await tx<{ name: string; message_locale: string }[]>`
        select name, message_locale from public.parents where phone = ${newPhone}
      `;
      return { reply: reply?.r, children, created, known };
    });
    expect(result.reply).toMatchObject({ created: 3, parents_created: 1 });
    expect(result.created).toEqual([{ name: "Айгуль", message_locale: "uz" }]);
    const [arman, dana, timur] = result.children;
    expect(arman?.parent_id).toBe(dana?.parent_id);
    expect(timur?.parent_id).toBe(result.known);
    expect(result.children.map((c) => c.phone)).toEqual([null, null, null]);
  });

  it("a child already on file under the parent's phone is a duplicate", async () => {
    const reply = await rolledBack(sql, async (tx) => {
      const phone = familyPhone();
      const parentId = await insertParent(tx, { name: "Асель", phone });
      await insertChild(tx, parentId, "Мирас");
      await become(tx, owner);
      const [row] = await tx<{ r: { created: number; duplicates: number } }[]>`
        select public.import_clients(
          ${"b".repeat(64)},
          ${tx.json([
            {
              line: 2,
              last_name: "семейный",
              first_name: "мирас",
              phone,
              group_id: null,
              new_group: null,
              ends_on: null,
              message_locale: "ru",
              parent_name: "Асель",
            },
          ])},
          '[]'::jsonb,
          ${TODAY}::date
        ) as r
      `;
      return row?.r;
    });
    expect(reply).toMatchObject({ created: 0, duplicates: 1 });
  });
});
