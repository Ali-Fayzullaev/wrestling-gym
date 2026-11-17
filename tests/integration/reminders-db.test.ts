import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";

import { connectLocalDb } from "./db";
import {
  insertClient,
  insertPayment,
  insertReversal,
  templateId,
} from "./support/fixtures";
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

/**
 * Committed fixtures stay in the database, so their phones must not collide with the per-file
 * testPhone() counter other suites use for rolled-back fixtures (phone duplicate checks).
 */
function committedPhone(): string {
  return `+7701${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-03-15";

type Opened = {
  id: string;
  client_id: string;
  opened_at: string;
  status: string;
  created: boolean;
};

type Marked = {
  id: string;
  status: string;
  marked_sent_at: string | null;
  changed: boolean;
};

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Hides seed clients so the screens only see this test's fixtures. */
async function onlyFixtures(tx: Tx) {
  await tx`update public.clients set archived_at = now() where archived_at is null`;
}

/** A client whose single payment (recorded long ago) ends `daysLeft` days after TODAY. */
async function clientEndingIn(
  tx: Tx,
  daysLeft: number,
  lastName = "Напоминаемый",
) {
  const clientId = await insertClient(tx, { lastName });
  const periodEnd = addDays(TODAY, daysLeft);
  const paymentId = await insertPayment(tx, {
    clientId,
    periodStart: addDays(periodEnd, -29),
    periodEnd,
    createdAt: new Date("2026-01-01T06:00:00Z"),
  });
  return { clientId, paymentId };
}

async function open(tx: Tx, paymentId: string, kind: string): Promise<Opened> {
  const [row] = await tx<{ r: Opened }[]>`
    select public.record_reminder_opened(${paymentId}, ${kind}) as r
  `;
  if (!row) throw new Error("record_reminder_opened returned nothing");
  return row.r;
}

async function mark(tx: Tx, eventId: string): Promise<Marked> {
  const [row] = await tx<{ r: Marked }[]>`
    select public.mark_reminder_sent(${eventId}) as r
  `;
  if (!row) throw new Error("mark_reminder_sent returned nothing");
  return row.r;
}

async function eventCount(db: Tx | postgres.Sql, paymentId: string) {
  const [row] = await db<{ n: number }[]>`
    select count(*)::int as n from public.reminder_events where payment_id = ${paymentId}
  `;
  return row?.n ?? 0;
}

/** An event opened at a fixed instant, as the migration owner (staff cannot backdate). */
async function eventAt(
  tx: Tx,
  input: {
    clientId: string;
    paymentId: string;
    kind: string;
    openedAt: string;
    openedBy?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.reminder_events (
      id, client_id, payment_id, kind, template_id, opened_by, opened_at
    ) values (
      ${id}, ${input.clientId}, ${input.paymentId}, ${input.kind},
      ${await templateId(tx, input.kind)}, ${input.openedBy ?? SEED_STAFF.admin},
      ${input.openedAt}
    )
  `;
  return id;
}

describe("criterion 3: repeated clicks record one event per subscription and kind", () => {
  it("two clicks: one event, the second call gets the first one back", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { paymentId } = await clientEndingIn(tx, 1);
      await become(tx, admin);
      const first = await open(tx, paymentId, "before_1");
      const second = await open(tx, paymentId, "before_1");
      return { first, second, count: await eventCount(tx, paymentId) };
    });
    expect(result.first.created).toBe(true);
    expect(result.second.created).toBe(false);
    expect(result.second.id).toBe(result.first.id);
    expect(result.second.opened_at).toBe(result.first.opened_at);
    expect(result.count).toBe(1);
  });

  it("another kind for the same subscription is a second event", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { paymentId } = await clientEndingIn(tx, 1);
      await become(tx, admin);
      const early = await open(tx, paymentId, "before_7");
      const late = await open(tx, paymentId, "before_1");
      return { early, late, count: await eventCount(tx, paymentId) };
    });
    expect(result.early.created && result.late.created).toBe(true);
    expect(result.late.id).not.toBe(result.early.id);
    expect(result.count).toBe(2);
  });

  it("stores who opened it, the template of that kind and the status chat_opened", async () => {
    const row = await rolledBack(sql, async (tx) => {
      const { clientId, paymentId } = await clientEndingIn(tx, 0);
      const expectedTemplate = await templateId(tx, "overdue");
      await become(tx, otherAdmin);
      const opened = await open(tx, paymentId, "overdue");
      const [event] = await tx<
        {
          client_id: string;
          opened_by: string;
          template_id: string;
          status: string;
        }[]
      >`
        select client_id, opened_by, template_id, status
        from public.reminder_events where id = ${opened.id}
      `;
      return { event, clientId, expectedTemplate };
    });
    expect(row.event).toEqual({
      client_id: row.clientId,
      opened_by: SEED_STAFF.otherAdmin,
      template_id: row.expectedTemplate,
      status: "chat_opened",
    });
  });

  it("the client leaves reminders_due and the counter, nothing else is touched", async () => {
    const result = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const { paymentId } = await clientEndingIn(tx, 1, "Уходит");
      await clientEndingIn(tx, 7, "Остаётся");
      await become(tx, admin);
      const due = async () =>
        (
          await tx<{ n: number }[]>`
            select count(*)::int as n from public.reminders_due(${TODAY}::date)
          `
        )[0]?.n;
      const counter = async () =>
        (
          await tx<{ n: number }[]>`
            select remind_today as n from public.dashboard_counts(${TODAY}::date)
          `
        )[0]?.n;
      const before = { due: await due(), counter: await counter() };
      await open(tx, paymentId, "before_1");
      return { before, after: { due: await due(), counter: await counter() } };
    });
    expect(result.before).toEqual({ due: 2, counter: 2 });
    expect(result.after).toEqual({ due: 1, counter: 1 });
  });

  it("ten parallel requests leave exactly one event and all get it back", async () => {
    // Committed: each request runs on its own connection. The client is archived, so it stays out
    // of the lists, and the events stay (they are append-only).
    const { paymentId } = await sql.begin(async (tx) => {
      const clientId = await insertClient(tx, {
        lastName: "Параллельный",
        archived: true,
        phone: committedPhone(),
      });
      const id = await insertPayment(tx, {
        clientId,
        periodStart: addDays(TODAY, -28),
        periodEnd: addDays(TODAY, 1),
      });
      return { paymentId: id };
    });
    const dbs = Array.from({ length: 10 }, () =>
      postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
    );
    try {
      const results = await Promise.all(
        dbs.map((db) =>
          db.begin(async (tx) => {
            await become(tx, admin);
            return open(tx, paymentId, "before_1");
          }),
        ),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
    expect(await eventCount(sql, paymentId)).toBe(1);
  });

  it("refuses a reversal, an unknown payment and an unknown kind", async () => {
    const run = (
      fn: (tx: Tx, paymentId: string, reversalId: string) => Promise<unknown>,
    ) =>
      rolledBack(sql, async (tx) => {
        const { clientId, paymentId } = await clientEndingIn(tx, 1);
        const reversalId = await insertReversal(tx, {
          clientId,
          reversesId: paymentId,
          periodStart: addDays(TODAY, -28),
          periodEnd: addDays(TODAY, 1),
        });
        await become(tx, admin);
        return fn(tx, paymentId, reversalId);
      });
    await expect(
      run((tx, _, reversalId) => open(tx, reversalId, "before_1")),
    ).rejects.toMatchObject({ message: "payment_not_found" });
    await expect(
      run((tx) => open(tx, randomUUID(), "before_1")),
    ).rejects.toMatchObject({ message: "payment_not_found" });
    await expect(
      run((tx, paymentId) => open(tx, paymentId, "before_3")),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("refuses anon and a deactivated employee", async () => {
    await expect(
      asActor(
        sql,
        "anon",
        (tx) =>
          tx`select public.record_reminder_opened(${randomUUID()}, 'before_1')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rolledBack(sql, async (tx) => {
        const { paymentId } = await clientEndingIn(tx, 1);
        await tx`update public.staff set active = false where id = ${SEED_STAFF.admin}`;
        await become(tx, admin);
        await open(tx, paymentId, "before_1");
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("criterion 4: marked_sent only from chat_opened, nothing else changes", () => {
  it("marks once; a second mark changes nothing and keeps the first time", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { paymentId } = await clientEndingIn(tx, 1);
      await become(tx, admin);
      const opened = await open(tx, paymentId, "before_1");
      await become(tx, otherAdmin);
      const first = await mark(tx, opened.id);
      const second = await mark(tx, opened.id);
      const [row] = await tx<{ marked_sent_by: string; status: string }[]>`
        select marked_sent_by, status from public.reminder_events where id = ${opened.id}
      `;
      return { first, second, row };
    });
    expect(result.first).toMatchObject({
      status: "marked_sent",
      changed: true,
    });
    expect(result.first.marked_sent_at).not.toBeNull();
    expect(result.second).toMatchObject({
      status: "marked_sent",
      changed: false,
      marked_sent_at: result.first.marked_sent_at,
    });
    expect(result.row).toEqual({
      marked_sent_by: SEED_STAFF.otherAdmin,
      status: "marked_sent",
    });
  });

  it.each([
    [
      "moving back to chat_opened",
      (tx: Tx, id: string) => tx`
        update public.reminder_events
        set status = 'chat_opened', marked_sent_by = null, marked_sent_at = null
        where id = ${id}
      `,
      "P0001",
    ],
    [
      "changing the kind",
      (tx: Tx, id: string) =>
        tx`update public.reminder_events set kind = 'overdue' where id = ${id}`,
      "42501",
    ],
    [
      "changing who opened it",
      (tx: Tx, id: string) =>
        tx`update public.reminder_events set opened_by = ${SEED_STAFF.owner} where id = ${id}`,
      "42501",
    ],
  ] as const)("staff: refuses %s", async (_, change, code) => {
    await expect(
      rolledBack(sql, async (tx) => {
        const { paymentId } = await clientEndingIn(tx, 1);
        await become(tx, admin);
        const opened = await open(tx, paymentId, "before_1");
        await mark(tx, opened.id);
        await change(tx, opened.id);
      }),
    ).rejects.toMatchObject({ code });
  });

  it("the trigger stops the table owner from moving back or rewriting other fields", async () => {
    for (const statement of [
      (tx: Tx, id: string) =>
        tx`update public.reminder_events set status = 'chat_opened', marked_sent_by = null, marked_sent_at = null where id = ${id}`,
      (tx: Tx, id: string) =>
        tx`update public.reminder_events set opened_at = now() - interval '1 day' where id = ${id}`,
    ]) {
      await expect(
        rolledBack(sql, async (tx) => {
          const { paymentId } = await clientEndingIn(tx, 1);
          await become(tx, admin);
          const opened = await open(tx, paymentId, "before_1");
          await mark(tx, opened.id);
          await become(tx, "postgres");
          await statement(tx, opened.id);
        }),
      ).rejects.toMatchObject({ code: "P0001" });
    }
  });

  it("an unknown event is reported, and anon is refused", async () => {
    await expect(
      asActor(sql, admin, (tx) => mark(tx, randomUUID())),
    ).rejects.toMatchObject({ message: "reminder_not_found" });
    await expect(
      asActor(
        sql,
        "anon",
        (tx) => tx`select public.mark_reminder_sent(${randomUUID()})`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("two parallel marks: one changes it, the other reports it was already marked", async () => {
    const { eventId } = await sql.begin(async (tx) => {
      const clientId = await insertClient(tx, {
        lastName: "Параллельный",
        archived: true,
        phone: committedPhone(),
      });
      const paymentId = await insertPayment(tx, {
        clientId,
        periodStart: addDays(TODAY, -28),
        periodEnd: addDays(TODAY, 1),
      });
      return {
        eventId: await eventAt(tx, {
          clientId,
          paymentId,
          kind: "before_1",
          openedAt: "2026-03-14T05:00:00Z",
        }),
      };
    });
    const dbs = [admin, otherAdmin].map(() =>
      postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
    );
    try {
      const results = await Promise.all(
        dbs.map((db, index) =>
          db.begin(async (tx) => {
            await become(tx, index === 0 ? admin : otherAdmin);
            return mark(tx, eventId);
          }),
        ),
      );
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(results.every((r) => r.status === "marked_sent")).toBe(true);
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
  });
});

type Settings = { reminder_days: number[] };
type AuditRow = {
  action: string;
  entity: string;
  entity_id: string | null;
  details: unknown;
};

async function saveSettings(
  tx: Tx,
  days: number[],
  templates: { id: string; body: string }[],
) {
  const [row] = await tx<
    { r: { days_changed: boolean; templates_changed: number } }[]
  >`
    select public.update_reminder_settings(${days}::integer[], ${tx.json(templates)}) as r
  `;
  if (!row) throw new Error("update_reminder_settings returned nothing");
  return row.r;
}

async function settings(tx: Tx): Promise<Settings> {
  const [row] = await tx<Settings[]>`select reminder_days from public.settings`;
  if (!row) throw new Error("no settings row");
  return row;
}

describe("criterion 5: only the owner changes templates and days", () => {
  it("admin: the settings function refuses and nothing changes", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const before7 = await templateId(tx, "before_7");
      await become(tx, admin);
      await tx`savepoint attempt`;
      const error = await saveSettings(
        tx,
        [5, 2],
        [{ id: before7, body: "Чужой текст" }],
      ).then(
        () => null,
        (caught: { code?: string }) => caught.code,
      );
      await tx`rollback to savepoint attempt`;
      const [template] = await tx<{ body: string }[]>`
        select body from public.message_templates where id = ${before7}
      `;
      return { error, settings: await settings(tx), body: template?.body };
    });
    expect(result.error).toBe("42501");
    expect(result.settings.reminder_days).toEqual([7, 1]);
    expect(result.body).not.toBe("Чужой текст");
  });

  it("admin: direct updates of templates and settings touch no rows", async () => {
    const touched = await asActor(sql, admin, async (tx) => {
      const templates = await tx`
        update public.message_templates set body = 'Чужой', updated_by = ${SEED_STAFF.admin}
        returning id
      `;
      const days =
        await tx`update public.settings set reminder_days = '{3}' returning id`;
      return templates.length + days.length;
    });
    expect(touched).toBe(0);
  });

  it("owner: saves days and a text, one audit row each, without the text itself", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const before7 = await templateId(tx, "before_7");
      const overdue = await templateId(tx, "overdue");
      const [overdueRow] = await tx<{ body: string }[]>`
        select body from public.message_templates where id = ${overdue}
      `;
      await become(tx, owner);
      const saved = await saveSettings(
        tx,
        [5, 2],
        [
          { id: before7, body: "Здравствуйте, {имя}! Секретная фраза." },
          { id: overdue, body: overdueRow?.body ?? "" },
        ],
      );
      const [template] = await tx<{ body: string; updated_by: string }[]>`
        select body, updated_by from public.message_templates where id = ${before7}
      `;
      const audit = await tx<AuditRow[]>`
        select action, entity, entity_id, details from public.audit_log
        where actor_id = ${SEED_STAFF.owner}
          and action in ('settings.update', 'template.update')
          and created_at = now()
        order by action
      `;
      return { saved, template, audit, settings: await settings(tx), before7 };
    });
    expect(result.saved).toEqual({ days_changed: true, templates_changed: 1 });
    expect(result.settings.reminder_days).toEqual([5, 2]);
    expect(result.template).toEqual({
      body: "Здравствуйте, {имя}! Секретная фраза.",
      updated_by: SEED_STAFF.owner,
    });
    expect(result.audit).toEqual([
      {
        action: "settings.update",
        entity: "settings",
        entity_id: null,
        details: { fields: ["reminder_days"], from: [7, 1], to: [5, 2] },
      },
      {
        action: "template.update",
        entity: "message_template",
        entity_id: result.before7,
        details: { fields: ["body"], kind: "before_7", locale: "ru" },
      },
    ]);
    expect(JSON.stringify(result.audit)).not.toContain("Секретная");
  });

  it("owner: saving the same values again writes nothing and no audit", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const templates = await tx<{ id: string; body: string }[]>`
        select id, body from public.message_templates
      `;
      await become(tx, owner);
      const saved = await saveSettings(tx, [7, 1], templates);
      const [audit] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.audit_log where created_at = now()
      `;
      return { saved, audit: audit?.n };
    });
    expect(result).toEqual({
      saved: { days_changed: false, templates_changed: 0 },
      audit: 0,
    });
  });

  it.each([
    ["equal days", [3, 3], "23514"],
    ["zero days", [0], "23514"],
    ["more than 60 days", [61], "23514"],
    ["three values", [7, 3, 1], "23514"],
  ])("owner: refuses %s", async (_, days, code) => {
    await expect(
      asActor(sql, owner, (tx) => saveSettings(tx, days, [])),
    ).rejects.toMatchObject({ code });
  });

  it("owner: refuses an unknown template and an empty text", async () => {
    await expect(
      asActor(sql, owner, (tx) =>
        saveSettings(tx, [7, 1], [{ id: randomUUID(), body: "Текст" }]),
      ),
    ).rejects.toMatchObject({ message: "template_not_found" });
    await expect(
      rolledBack(sql, async (tx) => {
        const id = await templateId(tx, "before_1");
        await become(tx, owner);
        await saveSettings(tx, [7, 1], [{ id, body: "   " }]);
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

type Contact = {
  id: string;
  last_name: string;
  phone: string;
  phone_owner: string;
  parent_name: string | null;
  group_name: string | null;
  price: number | null;
  payment_id: string;
  kind: string | null;
  ends_on: string | null;
};

type Event = {
  id: string;
  client_id: string;
  kind: string;
  status: string;
  opened_at: string;
  opened_by_name: string;
  marked_sent_by_name: string | null;
  last_name?: string;
};

async function tab<T>(
  tx: Tx,
  name: string,
  extra: { date?: string; staff?: string } = {},
) {
  const [row] = await tx<{ s: T }[]>`
    select public.reminders_screen(
      ${name}, ${TODAY}::date, ${extra.date ?? null}::date, ${extra.staff ?? null}::uuid
    ) as s
  `;
  if (!row) throw new Error("reminders_screen returned nothing");
  return row.s;
}

describe("reminders_screen", () => {
  it("today: due rows carry what the link is built from; opened rows are today's events", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const due = await clientEndingIn(tx, 7, "Неделя");
      const opened = await clientEndingIn(tx, 1, "Открыт");
      // 00:30 on 15 March in Almaty is today; 23:30 on 14 March is not.
      await eventAt(tx, {
        ...opened,
        kind: "before_1",
        openedAt: "2026-03-14T19:30:00Z",
      });
      const yesterday = await clientEndingIn(tx, 2, "Вчерашний");
      await eventAt(tx, {
        ...yesterday,
        kind: "before_1",
        openedAt: "2026-03-14T18:30:00Z",
      });
      await become(tx, admin);
      return {
        dueId: due.clientId,
        s: await tab<{
          context: { gym_name: string };
          due: Contact[];
          opened: Event[];
        }>(tx, "today"),
      };
    });
    expect(screen.s.due).toHaveLength(1);
    expect(screen.s.due[0]).toMatchObject({
      id: screen.dueId,
      last_name: "Неделя",
      phone_owner: "self",
      group_name: "Дети 6–9 лет, утро",
      price: 15000,
      kind: "before_7",
      ends_on: addDays(TODAY, 7),
    });
    expect(screen.s.due[0]?.phone).toMatch(/^\+77\d{9}$/);
    expect(screen.s.opened.map((e) => e.last_name)).toEqual(["Открыт"]);
    expect(screen.s.opened[0]).toMatchObject({
      kind: "before_1",
      status: "chat_opened",
      opened_by_name: "Данияр Примеров",
      marked_sent_by_name: null,
    });
    expect(screen.s.context.gym_name).toBeTruthy();
  });

  it("overdue: ended subscriptions of current clients, with their overdue event if any", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const reminded = await clientEndingIn(tx, -3, "Напомнили");
      await clientEndingIn(tx, -1, "Недавно");
      await clientEndingIn(tx, 0, "Сегодня"); // ends today: still valid, not overdue
      const archived = await clientEndingIn(tx, -2, "Архивный");
      await tx`update public.clients set archived_at = now() where id = ${archived.clientId}`;
      await eventAt(tx, {
        ...reminded,
        kind: "overdue",
        openedAt: "2026-03-12T05:00:00Z",
      });
      await become(tx, admin);
      return tab<{ overdue: (Contact & { event: Event | null })[] }>(
        tx,
        "overdue",
      );
    });
    expect(screen.overdue.map((row) => row.last_name)).toEqual([
      "Недавно",
      "Напомнили",
    ]);
    expect(screen.overdue[0]?.event).toBeNull();
    expect(screen.overdue[1]?.event).toMatchObject({
      kind: "overdue",
      status: "chat_opened",
    });
    expect(screen.overdue.every((row) => row.kind === "overdue")).toBe(true);
  });

  it("history: one day, filtered by who opened or who marked, with the staff list", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const a = await clientEndingIn(tx, 1, "Первый");
      const b = await clientEndingIn(tx, 2, "Второй");
      const c = await clientEndingIn(tx, 3, "Другойдень");
      await eventAt(tx, {
        ...a,
        kind: "before_1",
        openedAt: "2026-03-15T04:00:00Z",
      });
      const markedId = await eventAt(tx, {
        ...b,
        kind: "before_1",
        openedAt: "2026-03-15T06:00:00Z",
        openedBy: SEED_STAFF.owner,
      });
      await eventAt(tx, {
        ...c,
        kind: "before_1",
        openedAt: "2026-03-14T06:00:00Z",
      });
      await become(tx, otherAdmin);
      await mark(tx, markedId);
      await become(tx, admin);
      type History = { events: Event[]; staff: { id: string; name: string }[] };
      return {
        all: await tab<History>(tx, "history", { date: TODAY }),
        byAdmin: await tab<History>(tx, "history", {
          date: TODAY,
          staff: SEED_STAFF.admin,
        }),
        byMarker: await tab<History>(tx, "history", {
          date: TODAY,
          staff: SEED_STAFF.otherAdmin,
        }),
        dayBefore: await tab<History>(tx, "history", { date: "2026-03-14" }),
      };
    });
    const names = (events: Event[]) =>
      events
        .map((e) => e.last_name)
        .filter((n) => ["Первый", "Второй", "Другойдень"].includes(n ?? ""));
    expect(names(result.all.events)).toEqual(["Второй", "Первый"]);
    expect(names(result.byAdmin.events)).toEqual(["Первый"]);
    expect(names(result.byMarker.events)).toEqual(["Второй"]);
    expect(result.byMarker.events[0]?.marked_sent_by_name).toBe(
      "Айгерим Образцова",
    );
    expect(names(result.dayBefore.events)).toEqual(["Другойдень"]);
    // Other suites add staff of their own; the seed staff must all be offered.
    expect(result.all.staff.map((person) => person.id)).toEqual(
      expect.arrayContaining(Object.values(SEED_STAFF)),
    );
  });

  it("refuses an unknown tab and anon", async () => {
    await expect(
      asActor(sql, admin, (tx) => tab(tx, "all")),
    ).rejects.toMatchObject({
      code: "22023",
    });
    await expect(
      asActor(sql, "anon", (tx) => tab(tx, "today")),
    ).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("client card and settings screen", () => {
  it("client_screen lists the client's reminder events, newest first, with names", async () => {
    const reminders = await rolledBack(sql, async (tx) => {
      const client = await clientEndingIn(tx, 1);
      await eventAt(tx, {
        ...client,
        kind: "before_7",
        openedAt: "2026-03-09T05:00:00Z",
      });
      const late = await eventAt(tx, {
        ...client,
        kind: "before_1",
        openedAt: "2026-03-14T05:00:00Z",
      });
      await become(tx, owner);
      await mark(tx, late);
      const [row] = await tx<{ r: Event[] }[]>`
        select public.client_screen(${client.clientId}, ${TODAY}::date) -> 'reminders' as r
      `;
      return row?.r ?? [];
    });
    expect(reminders.map((e) => [e.kind, e.status])).toEqual([
      ["before_1", "marked_sent"],
      ["before_7", "chat_opened"],
    ]);
    expect(reminders[0]?.marked_sent_by_name).toBe("Нурлан Тестов");
  });

  it("reminder_settings_screen: days, three templates per language and a real client with a group", async () => {
    const screen = await asActor(sql, owner, async (tx) => {
      const [row] = await tx<
        {
          s: {
            context: {
              reminder_days: number[];
              templates: { kind: string; locale: string; edited: boolean }[];
            };
            preview: Contact | null;
          };
        }[]
      >`select public.reminder_settings_screen(${TODAY}::date) as s`;
      return row?.s;
    });
    expect(screen?.context.reminder_days).toEqual([7, 1]);
    // Ordered by kind, then language. Other suites edit (and put back) Russian texts only, so the
    // shipped Kazakh and Uzbek drafts are still unedited.
    const templates = screen?.context.templates ?? [];
    expect(templates.map((t) => `${t.kind}:${t.locale}`)).toEqual(
      ["before_1", "before_7", "overdue"].flatMap((kind) =>
        ["kk", "ru", "uz"].map((locale) => `${kind}:${locale}`),
      ),
    );
    expect(
      templates.filter((t) => t.locale !== "ru").map((t) => t.edited),
    ).toEqual(Array(6).fill(false));
    expect(screen?.preview?.group_name).toBeTruthy();
    expect(screen?.preview?.price).toBeGreaterThan(0);
  });
});
