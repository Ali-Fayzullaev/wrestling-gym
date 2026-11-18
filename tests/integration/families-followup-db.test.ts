import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";

import {
  parseRemindersOverdue,
  parseRemindersToday,
} from "@/features/reminders/service";

import { connectLocalDb } from "./db";
import { insertChild, insertParent, paidUntil } from "./support/families";
import { insertClient } from "./support/fixtures";
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

// Step 22: the family block on the Reminders screen, parent archive and delete.

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-03-15";
/** 11:00 in Asia/Almaty on TODAY: the clock the screens are parsed with. */
const NOW = new Date("2026-03-15T06:00:00Z");
const PERMISSION_DENIED = { code: "42501" };

type Item = { payment_id: string; kind: string };

async function screen(tx: Tx, tab: "today" | "overdue"): Promise<unknown> {
  const [row] = await tx<{ r: unknown }[]>`
    select public.reminders_screen(${tab}, ${TODAY}::date) as r
  `;
  return row?.r;
}

async function openFamily(tx: Tx, parentId: string, items: Item[]) {
  await tx`select public.record_family_reminder_opened(${parentId}, ${tx.json(items)})`;
}

type Marked = { id: string; status: string; changed: boolean };

async function markFamily(
  tx: Tx,
  parentId: string,
  items: Item[],
): Promise<Marked[]> {
  const [row] = await tx<{ r: Marked[] }[]>`
    select public.mark_family_reminders_sent(${parentId}, ${tx.json(items)}) as r
  `;
  return row?.r ?? [];
}

/** A parent with two children ending in 7 and 1 days: both due on the Today tab. */
async function familyDueToday(tx: Tx) {
  const parentId = await insertParent(tx, { phone: "+77031234567" });
  const arman = await insertChild(tx, parentId, "Арман");
  const dana = await insertChild(tx, parentId, "Дана");
  return {
    parentId,
    arman,
    dana,
    items: [
      {
        payment_id: await paidUntil(tx, arman, "2026-03-22"),
        kind: "before_7",
      },
      { payment_id: await paidUntil(tx, dana, "2026-03-16"), kind: "before_1" },
    ],
  };
}

/** Two children whose subscriptions ended, and a third one due in 7 days. */
async function familyOverdue(tx: Tx) {
  const parentId = await insertParent(tx, { phone: "+77037654321" });
  const arman = await insertChild(tx, parentId, "Арман");
  const dana = await insertChild(tx, parentId, "Дана");
  const timur = await insertChild(tx, parentId, "Тимур");
  return {
    parentId,
    arman,
    dana,
    timur,
    items: [
      { payment_id: await paidUntil(tx, arman, "2026-03-12"), kind: "overdue" },
      { payment_id: await paidUntil(tx, dana, "2026-03-10"), kind: "overdue" },
    ],
    timurPayment: await paidUntil(tx, timur, "2026-03-22"),
  };
}

function decoded(href: string | undefined): string {
  return href ? (new URL(href).searchParams.get("text") ?? "") : "";
}

describe("criterion 1: Reminders, Today tab: one block per parent", () => {
  it("two children of one parent due today give one block and one wa.me link to the parent", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      await become(tx, admin);
      return { f, data: parseRemindersToday(await screen(tx, "today"), NOW) };
    });
    const mine = result.data.due.filter(
      (entry) => entry.family?.parent.id === result.f.parentId,
    );
    expect(mine).toHaveLength(1);
    const [block] = mine;
    expect(block?.items.map((item) => item.clientId).sort()).toEqual(
      [result.f.arman, result.f.dana].sort(),
    );
    expect(block?.family?.firstNames).toEqual(["Дана", "Арман"]);
    expect(block?.family?.target).toEqual({
      parentId: result.f.parentId,
      items: [
        { paymentId: result.f.items[1]?.payment_id, kind: "before_1" },
        { paymentId: result.f.items[0]?.payment_id, kind: "before_7" },
      ],
    });
    const href = block?.family?.message?.variants.ru.href;
    expect(href).toMatch(/^https:\/\/wa\.me\/77031234567\?text=/);
    expect(decoded(href)).toContain("Арман: до ");
    expect(decoded(href)).toContain("Дана: до ");
    // No row of these children is left outside the block.
    const singles = result.data.due.flatMap((entry) =>
      entry.family ? [] : entry.items.map((item) => item.clientId),
    );
    expect(singles).not.toContain(result.f.arman);
    expect(singles).not.toContain(result.f.dana);
  });

  it("chats opened today come back as one block per parent with each child's status", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      await become(tx, admin);
      await openFamily(tx, f.parentId, f.items);
      await markFamily(tx, f.parentId, [f.items[0] as Item]);
      // Opened "today" is the server's clock: parse with the real day.
      const [row] = await tx<{ r: unknown }[]>`
        select public.reminders_screen('today') as r
      `;
      return { f, data: parseRemindersToday(row?.r, new Date()) };
    });
    const mine = result.data.opened.filter(
      (entry) => entry.parent?.id === result.f.parentId,
    );
    expect(mine).toHaveLength(1);
    const statuses = Object.fromEntries(
      mine[0]?.events.map((e) => [e.clientId, e.status]) ?? [],
    );
    expect(statuses).toEqual({
      [result.f.arman]: "marked_sent",
      [result.f.dana]: "chat_opened",
    });
  });
});

describe("criterion 2: Reminders, Overdue tab: one block per parent", () => {
  it("two overdue children make one block; a child with another reminder stays out", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyOverdue(tx);
      await become(tx, owner);
      return {
        f,
        overdue: parseRemindersOverdue(await screen(tx, "overdue"), NOW),
        today: parseRemindersToday(await screen(tx, "today"), NOW),
      };
    });
    const mine = result.overdue.overdue.filter((entry) =>
      entry.items.some((item) =>
        [result.f.arman, result.f.dana, result.f.timur].includes(item.clientId),
      ),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.family?.parent.id).toBe(result.f.parentId);
    expect(mine[0]?.items.map((item) => item.clientId)).toEqual([
      result.f.arman,
      result.f.dana,
    ]);
    expect(mine[0]?.family?.target.items.map((item) => item.kind)).toEqual([
      "overdue",
      "overdue",
    ]);
    // Timur's 7-day reminder is on the Today tab, on his own (the only one due today).
    const timur = result.today.due.filter((entry) =>
      entry.items.some((item) => item.clientId === result.f.timur),
    );
    expect(timur).toHaveLength(1);
    expect(timur[0]?.family).toBeNull();
    expect(timur[0]?.items[0]?.kind).toBe("before_7");
  });

  it("each child in the block carries its own event", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyOverdue(tx);
      await become(tx, admin);
      await openFamily(tx, f.parentId, f.items);
      await markFamily(tx, f.parentId, [f.items[1] as Item]);
      return {
        f,
        data: parseRemindersOverdue(await screen(tx, "overdue"), NOW),
      };
    });
    const block = result.data.overdue.find(
      (entry) => entry.family?.parent.id === result.f.parentId,
    );
    expect(block?.items.map((item) => item.event?.status)).toEqual([
      "chat_opened",
      "marked_sent",
    ]);
  });
});

describe("criterion 3: WhatsApp from an overdue block: chat opened per child, no doubles", () => {
  it("a repeat keeps one event per child", async () => {
    const counts = await rolledBack(sql, async (tx) => {
      const f = await familyOverdue(tx);
      await become(tx, admin);
      await openFamily(tx, f.parentId, f.items);
      await openFamily(tx, f.parentId, f.items);
      return tx<{ client_id: string; n: number }[]>`
        select client_id, count(*)::int as n from public.reminder_events
        where client_id in ${tx([f.arman, f.dana])} group by client_id
      `;
    });
    expect(counts.map((row) => row.n)).toEqual([1, 1]);
  });

  it("parallel clicks leave exactly one overdue event per child", async () => {
    // Committed: parallel sessions must see the same rows. Archived, so no screen shows them.
    const f = await sql.begin(async (tx) => {
      const parentId = await insertParent(tx);
      const a = await insertChild(tx, parentId, "Параллельный");
      const b = await insertChild(tx, parentId, "Параллельная");
      await tx`update public.clients set archived_at = now() where id in ${tx([a, b])}`;
      return {
        parentId,
        items: [
          { payment_id: await paidUntil(tx, a, "2026-03-12"), kind: "overdue" },
          { payment_id: await paidUntil(tx, b, "2026-03-10"), kind: "overdue" },
        ],
      };
    });
    const dbs = [0, 1, 2].map(() =>
      postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
    );
    try {
      await Promise.all(
        dbs.map((db) =>
          db.begin(async (tx) => {
            await become(tx, admin);
            await openFamily(tx, f.parentId, f.items);
          }),
        ),
      );
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.reminder_events
      where payment_id in ${sql(f.items.map((item) => item.payment_id))}
    `;
    expect(count?.n).toBe(2);
  });
});

describe("criterion 4: Sent for a block marks every child in one transaction", () => {
  it("marks all opened children; a repeat changes nothing", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      await become(tx, admin);
      await openFamily(tx, f.parentId, f.items);
      const first = await markFamily(tx, f.parentId, f.items);
      const again = await markFamily(tx, f.parentId, f.items);
      const rows = await tx<{ status: string; marked_sent_by: string }[]>`
        select status, marked_sent_by from public.reminder_events
        where client_id in ${tx([f.arman, f.dana])}
      `;
      return { first, again, rows };
    });
    expect(result.first.map((row) => row.changed)).toEqual([true, true]);
    expect(result.again.map((row) => row.changed)).toEqual([false, false]);
    expect(result.rows).toEqual([
      { status: "marked_sent", marked_sent_by: SEED_STAFF.admin },
      { status: "marked_sent", marked_sent_by: SEED_STAFF.admin },
    ]);
  });

  it("marks only the rest when part of the block is marked already", async () => {
    const marked = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      await become(tx, admin);
      await openFamily(tx, f.parentId, f.items);
      await markFamily(tx, f.parentId, [f.items[0] as Item]);
      return markFamily(tx, f.parentId, f.items);
    });
    expect(marked.map((row) => row.changed)).toEqual([false, true]);
  });

  it("a child whose chat was never opened refuses the whole call", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyOverdue(tx);
      await become(tx, admin);
      // Only Arman's chat is opened (a single reminder); Dana has no event.
      await tx`select public.record_reminder_opened(${f.items[0]?.payment_id ?? ""}, 'overdue')`;
      const error = await tx
        .savepoint((sp) => markFamily(sp, f.parentId, f.items))
        .catch((e: unknown) => e);
      const rows = await tx<{ status: string }[]>`
        select status from public.reminder_events where client_id = ${f.arman}
      `;
      return { error, rows };
    });
    expect(result.error).toMatchObject({
      code: "P0002",
      message: "reminder_not_found",
    });
    expect(result.rows).toEqual([{ status: "chat_opened" }]);
  });

  it("refuses a child of another parent, bad items and a stranger", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const f = await familyDueToday(tx);
      const stranger = await insertClient(tx);
      const strangerItem = {
        payment_id: await paidUntil(tx, stranger, "2026-03-22"),
        kind: "before_7",
      };
      await become(tx, admin);
      await tx`select public.record_reminder_opened(${strangerItem.payment_id}, 'before_7')`;
      await openFamily(tx, f.parentId, f.items);
      const attempt = (items: unknown, parentId = f.parentId) =>
        tx
          .savepoint(
            (sp) =>
              sp`select public.mark_family_reminders_sent(${parentId}, ${sp.json(items as Item[])})`,
          )
          .catch((e: unknown) => e);
      return {
        stranger: await attempt([f.items[0], strangerItem]),
        empty: await attempt([]),
        doubled: await attempt([f.items[0], f.items[0]]),
        kind: await attempt([{ ...f.items[0], kind: "family" }]),
        parent: await attempt(f.items, randomUUID()),
      };
    });
    expect(result.stranger).toMatchObject({ message: "reminder_not_found" });
    expect(result.empty).toMatchObject({ code: "22023" });
    expect(result.doubled).toMatchObject({ code: "22023" });
    expect(result.kind).toMatchObject({ code: "22023" });
    expect(result.parent).toMatchObject({ message: "parent_not_found" });
    await expect(
      asActor(sql, { userId: randomUUID() }, async (tx) => {
        const f = await familyDueToday(tx);
        return markFamily(tx, f.parentId, f.items);
      }),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(sql, "anon", (tx) => markFamily(tx, randomUUID(), [])),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

type AuditRow = { action: string; entity_id: string; details: unknown };

async function auditOf(tx: Tx, parentId: string): Promise<AuditRow[]> {
  return tx<AuditRow[]>`
    select action, entity_id, details from public.audit_log
    where entity = 'parent' and entity_id = ${parentId}
    -- One transaction gives every row the same created_at; "archive" sorts before "restore".
    order by created_at, action
  `;
}

async function setArchived(tx: Tx, parentId: string, archived: boolean) {
  const [row] = await tx<{ changed: boolean }[]>`
    select public.set_parent_archived(${parentId}, ${archived}) as changed
  `;
  return row?.changed;
}

describe("criterion 6: archiving and restoring a parent", () => {
  for (const [name, actor] of [
    ["owner", owner],
    ["admin", admin],
  ] as const) {
    it(`${name}: archives a parent whose children are archived, restores, repeats change nothing`, async () => {
      const result = await rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx);
        const child = await insertChild(tx, parentId, "Архивный");
        await tx`update public.clients set archived_at = now() where id = ${child}`;
        await become(tx, actor);
        const steps = [
          await setArchived(tx, parentId, true),
          await setArchived(tx, parentId, true),
        ];
        const [archived] = await tx<{ archived: boolean }[]>`
          select archived_at is not null as archived from public.parents where id = ${parentId}
        `;
        steps.push(
          await setArchived(tx, parentId, false),
          await setArchived(tx, parentId, false),
        );
        await become(tx, "postgres");
        return {
          steps,
          archived,
          audit: await auditOf(tx, parentId),
          parentId,
        };
      });
      expect(result.steps).toEqual([true, false, true, false]);
      expect(result.archived).toEqual({ archived: true });
      expect(result.audit).toEqual([
        { action: "parent.archive", entity_id: result.parentId, details: {} },
        { action: "parent.restore", entity_id: result.parentId, details: {} },
      ]);
    });
  }

  it("STUB(D-23): a parent with a child not in the archive is refused, nothing written", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      await insertChild(tx, parentId, "Активный");
      await become(tx, admin);
      const error = await tx
        .savepoint((sp) => setArchived(sp, parentId, true))
        .catch((e: unknown) => e);
      await become(tx, "postgres");
      const [row] = await tx<{ archived_at: Date | null }[]>`
        select archived_at from public.parents where id = ${parentId}
      `;
      return { error, row, audit: await auditOf(tx, parentId) };
    });
    expect(result.error).toMatchObject({
      code: "23514",
      message: "parent_has_active_children",
    });
    expect(result.row).toEqual({ archived_at: null });
    expect(result.audit).toEqual([]);
  });

  it("refuses a stranger, anon and an unknown parent", async () => {
    await expect(
      asActor(sql, { userId: randomUUID() }, async (tx) =>
        setArchived(tx, randomUUID(), true),
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(sql, "anon", (tx) => setArchived(tx, randomUUID(), true)),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asActor(sql, admin, (tx) => setArchived(tx, randomUUID(), true)),
    ).rejects.toMatchObject({ code: "P0002", message: "parent_not_found" });
  });
});

const PARENT_ARCHIVED = { code: "23514", message: "parent_archived" };

/** Statements of other sessions waiting for a row lock right now. */
async function lockWaiters(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity
    where wait_event_type = 'Lock' and datname = current_database()
  `;
  return row?.n ?? 0;
}

async function untilLockWaiter() {
  for (let i = 0; i < 100; i += 1) {
    if ((await lockWaiters()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no session started waiting for the lock");
}

function createChildOf(tx: Tx, parentId: string) {
  return tx`
    select public.create_client(
      p_last_name => 'Гоночный',
      p_first_name => 'Ребёнок',
      p_started_on => ${TODAY}::date,
      p_parent_id => ${parentId}::uuid,
      p_group_id => ${SEED_GROUP}::uuid
    )
  `;
}

describe("STUB(D-23): no child in work with an archived parent, on any path", () => {
  it("bringing a child back from the archive while the parent is archived is refused", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      const child = await insertChild(tx, parentId, "Архивный");
      await tx`update public.clients set archived_at = now() where id = ${child}`;
      await tx`update public.parents set archived_at = now() where id = ${parentId}`;
      await become(tx, admin);
      const error = await tx
        .savepoint(
          (sp) => sp`select public.set_client_archived(${child}, false)`,
        )
        .catch((e: unknown) => e);
      const [row] = await tx<{ archived: boolean }[]>`
        select archived_at is not null as archived from public.clients where id = ${child}
      `;
      return { error, row };
    });
    expect(result.error).toMatchObject(PARENT_ARCHIVED);
    expect(result.row).toEqual({ archived: true });
  });

  it("a direct insert or a move to an archived parent is refused by the table itself", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const archived = await insertParent(tx, { archived: true });
      const current = await insertParent(tx);
      const child = await insertChild(tx, current, "Переводимый");
      const insert = await tx
        .savepoint((sp) => insertChild(sp, archived, "Новый"))
        .catch((e: unknown) => e);
      const move = await tx
        .savepoint(
          (sp) =>
            sp`update public.clients set parent_id = ${archived} where id = ${child}`,
        )
        .catch((e: unknown) => e);
      // An archived child may be linked to an archived parent: nobody is reminded.
      await tx`update public.clients set archived_at = now() where id = ${child}`;
      await tx`update public.clients set parent_id = ${archived} where id = ${child}`;
      return { insert, move };
    });
    expect(result.insert).toMatchObject(PARENT_ARCHIVED);
    expect(result.move).toMatchObject(PARENT_ARCHIVED);
  });

  it("a child saved while the parent is being archived waits and is refused once it is", async () => {
    // Committed: two sessions must see the same rows. The parent has no child at all.
    const parentId = await sql.begin((tx) => insertParent(tx));
    const archiver = postgres(inject("databaseUrl"), {
      max: 1,
      onnotice: () => undefined,
    });
    const saver = postgres(inject("databaseUrl"), {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const parentLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const archiving = archiver.begin(async (tx) => {
        await become(tx, admin);
        await setArchived(tx, parentId, true);
        locked();
        await released;
      });
      await parentLocked;
      const saving = saver
        .begin(async (tx) => {
          await become(tx, admin);
          await createChildOf(tx, parentId);
        })
        .catch((e: unknown) => e);
      await untilLockWaiter();
      release();
      await archiving;
      expect(await saving).toMatchObject(PARENT_ARCHIVED);
    } finally {
      await Promise.all([archiver.end(), saver.end()]);
    }
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.clients where parent_id = ${parentId}
    `;
    expect(count?.n).toBe(0);
    await sql`delete from public.parents where id = ${parentId}`;
  });

  it("archiving while a child is being saved waits and is refused once the child is in", async () => {
    const parentId = await sql.begin((tx) => insertParent(tx));
    const saver = postgres(inject("databaseUrl"), {
      max: 1,
      onnotice: () => undefined,
    });
    const archiver = postgres(inject("databaseUrl"), {
      max: 1,
      onnotice: () => undefined,
    });
    let childId: string | undefined;
    try {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let saved: () => void = () => undefined;
      const childSaved = new Promise<void>((resolve) => {
        saved = resolve;
      });
      const saving = saver.begin(async (tx) => {
        await become(tx, admin);
        const [row] = await createChildOf(tx, parentId);
        childId = row?.create_client as string | undefined;
        saved();
        await released;
      });
      await childSaved;
      const archiving = archiver
        .begin(async (tx) => {
          await become(tx, admin);
          await setArchived(tx, parentId, true);
        })
        .catch((e: unknown) => e);
      await untilLockWaiter();
      release();
      await saving;
      expect(await archiving).toMatchObject({
        code: "23514",
        message: "parent_has_active_children",
      });
    } finally {
      await Promise.all([archiver.end(), saver.end()]);
    }
    const [row] = await sql<{ archived: boolean }[]>`
      select archived_at is not null as archived from public.parents where id = ${parentId}
    `;
    expect(row).toEqual({ archived: false });
    // The child has no payments: both rows can go.
    if (childId) await sql`delete from public.clients where id = ${childId}`;
    await sql`delete from public.parents where id = ${parentId}`;
  });
});

async function deleteParent(
  tx: Tx,
  parentId: string,
  reason = "created_by_mistake",
  name = "Айгуль",
) {
  await tx`select public.delete_parent(${parentId}, ${reason}, ${name})`;
}

async function parentExists(tx: Tx, parentId: string): Promise<boolean> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.parents where id = ${parentId}
  `;
  return row?.n === 1;
}

describe("criterion 7: deleting a parent", () => {
  it("the owner deletes a parent without children; the audit names the reason only", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx, { name: "Айгуль" });
      await become(tx, owner);
      // The typed name is compared like the client's last name: case and spaces do not matter.
      await deleteParent(tx, parentId, "duplicate", "  айгуль ");
      await become(tx, "postgres");
      return {
        parentId,
        exists: await parentExists(tx, parentId),
        audit: await auditOf(tx, parentId),
      };
    });
    expect(result.exists).toBe(false);
    expect(result.audit).toEqual([
      {
        action: "parent.delete",
        entity_id: result.parentId,
        details: { reason: "duplicate" },
      },
    ]);
    expect(JSON.stringify(result.audit)).not.toContain("Айгуль");
  });

  it("a parent left only with blanked deleted children can be deleted", async () => {
    const exists = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      const child = await insertChild(tx, parentId, "Удаляемый");
      await paidUntil(tx, child, "2026-03-22");
      await become(tx, owner);
      await tx`select public.delete_client(${child}, 'duplicate', 'Семейный')`;
      await deleteParent(tx, parentId);
      return parentExists(tx, parentId);
    });
    expect(exists).toBe(false);
  });

  it("refuses a parent with a child, also with an archived one", async () => {
    for (const archived of [false, true]) {
      const result = await rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx);
        const child = await insertChild(tx, parentId, "Ребёнок");
        if (archived) {
          await tx`update public.clients set archived_at = now() where id = ${child}`;
        }
        await become(tx, owner);
        const error = await tx
          .savepoint((sp) => deleteParent(sp, parentId))
          .catch((e: unknown) => e);
        return { error, exists: await parentExists(tx, parentId) };
      });
      expect(result.error).toMatchObject({
        code: "23503",
        message: "parent_has_children",
      });
      expect(result.exists).toBe(true);
    }
  });

  it("refuses a wrong name, an unknown reason and an unknown parent", async () => {
    const attempt = (reason: string, name: string, known = true) =>
      asActor(sql, "postgres", async (tx) => {
        const parentId = await insertParent(tx, { name: "Айгуль" });
        await become(tx, owner);
        return deleteParent(tx, known ? parentId : randomUUID(), reason, name);
      });
    await expect(attempt("duplicate", "Гульнара")).rejects.toMatchObject({
      code: "22023",
      message: "confirmation_mismatch",
    });
    await expect(attempt("because", "Айгуль")).rejects.toMatchObject({
      code: "22023",
      message: "invalid_reason",
    });
    await expect(attempt("duplicate", "Айгуль", false)).rejects.toMatchObject({
      code: "P0002",
      message: "parent_not_found",
    });
  });

  it("admin, anon and a stranger are refused by the database", async () => {
    const attempt = (actor: Parameters<typeof become>[1]) =>
      asActor(sql, "postgres", async (tx) => {
        const parentId = await insertParent(tx);
        await become(tx, actor);
        const error = await tx
          .savepoint((sp) => deleteParent(sp, parentId))
          .catch((e: unknown) => e);
        await become(tx, "postgres");
        return { error, exists: await parentExists(tx, parentId) };
      });
    for (const actor of [admin, "anon" as const, { userId: randomUUID() }]) {
      const result = await attempt(actor);
      expect(result.error).toMatchObject(PERMISSION_DENIED);
      expect(result.exists).toBe(true);
    }
  });

  it("RLS: admin's direct DELETE removes nothing", async () => {
    const exists = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      await become(tx, admin);
      await tx`delete from public.parents where id = ${parentId}`;
      await become(tx, "postgres");
      return parentExists(tx, parentId);
    });
    expect(exists).toBe(true);
  });
});
