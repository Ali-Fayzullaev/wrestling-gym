import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";

import { connectLocalDb } from "./db";
import { insertClient, insertPayment, templateId } from "./support/fixtures";
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

// Step 20 (D-17): the language of one reminder, chosen when it is sent.

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

/** A client of that language with a paid subscription. */
async function clientOf(tx: Tx, messageLocale: string) {
  const clientId = await insertClient(tx, { messageLocale });
  const paymentId = await insertPayment(tx, {
    clientId,
    periodStart: "2026-02-21",
    periodEnd: "2026-03-22",
    createdAt: new Date("2026-02-21T06:00:00Z"),
  });
  return { clientId, paymentId };
}

type Opened = { id: string; created: boolean };

async function open(
  tx: Tx,
  paymentId: string,
  kind: string,
  locale: string | null,
): Promise<Opened> {
  const [row] = await tx<{ r: Opened }[]>`
    select public.record_reminder_opened(${paymentId}, ${kind}, ${locale}) as r
  `;
  if (!row) throw new Error("no result");
  return row.r;
}

async function eventsOf(tx: Tx, paymentId: string) {
  return tx<{ kind: string; template_id: string }[]>`
    select kind, template_id from public.reminder_events where payment_id = ${paymentId}
  `;
}

describe("criterion 3: the event names the template of the chosen language", () => {
  it("a Russian client sent in Uzbek: the Uzbek template", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { paymentId } = await clientOf(tx, "ru");
      await become(tx, admin);
      await open(tx, paymentId, "before_1", "uz");
      return {
        events: await eventsOf(tx, paymentId),
        uzbek: await templateId(tx, "before_1", "uz"),
      };
    });
    expect(result.events).toEqual([
      { kind: "before_1", template_id: result.uzbek },
    ]);
  });

  it("each language, also for the owner", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const kk = await clientOf(tx, "uz");
      const ru = await clientOf(tx, "kk");
      await become(tx, owner);
      await open(tx, kk.paymentId, "overdue", "kk");
      await open(tx, ru.paymentId, "overdue", "ru");
      return {
        kk: (await eventsOf(tx, kk.paymentId))[0]?.template_id,
        ru: (await eventsOf(tx, ru.paymentId))[0]?.template_id,
        expected: {
          kk: await templateId(tx, "overdue", "kk"),
          ru: await templateId(tx, "overdue", "ru"),
        },
      };
    });
    expect({ kk: result.kk, ru: result.ru }).toEqual(result.expected);
  });

  it("no language given: the client's, as in step 19", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { paymentId } = await clientOf(tx, "kk");
      await become(tx, admin);
      await open(tx, paymentId, "before_7", null);
      return {
        events: await eventsOf(tx, paymentId),
        kazakh: await templateId(tx, "before_7", "kk"),
      };
    });
    expect(result.events[0]?.template_id).toBe(result.kazakh);
  });

  it("the chosen language has no template: the Russian one", async () => {
    const result = await rolledBack(sql, async (tx) => {
      // Only a migration could remove a template; as postgres, inside a rolled-back transaction.
      // The same template as the step 19 test: no committed event may reference it.
      await tx`delete from public.message_templates where kind = 'overdue' and locale = 'kk'`;
      const { paymentId } = await clientOf(tx, "uz");
      await become(tx, admin);
      await open(tx, paymentId, "overdue", "kk");
      return {
        events: await eventsOf(tx, paymentId),
        russian: await templateId(tx, "overdue", "ru"),
      };
    });
    expect(result.events[0]?.template_id).toBe(result.russian);
  });

  it("a language outside ru, kk, uz is refused and nothing is written", async () => {
    for (const locale of ["en", "uz-Latn", "", "RU"]) {
      const result = await rolledBack(sql, async (tx) => {
        const { paymentId } = await clientOf(tx, "ru");
        await become(tx, admin);
        const error = await tx`savepoint s`
          .then(() => open(tx, paymentId, "before_1", locale))
          .then(
            () => null,
            (caught: unknown) => caught,
          );
        await tx`rollback to savepoint s`;
        return { error, events: await eventsOf(tx, paymentId) };
      });
      expect(result.error, locale).toMatchObject({
        code: "22023",
        message: "invalid_locale",
      });
      expect(result.events, locale).toEqual([]);
    }
  });

  it("refuses anon and a deactivated employee whatever the language", async () => {
    await expect(
      asActor(
        sql,
        "anon",
        (tx) =>
          tx`select public.record_reminder_opened(${randomUUID()}, 'before_1', 'uz')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rolledBack(sql, async (tx) => {
        const { paymentId } = await clientOf(tx, "ru");
        await tx`update public.staff set active = false where id = ${SEED_STAFF.admin}`;
        await become(tx, admin);
        await open(tx, paymentId, "before_1", "uz");
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("criterion 2: sending in another language leaves the card alone", () => {
  it("clients.message_locale and the client row stay as they were, no audit row", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { clientId, paymentId } = await clientOf(tx, "ru");
      const [before] =
        await tx`select * from public.clients where id = ${clientId}`;
      const [audit] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.audit_log where entity_id = ${clientId}
      `;
      await become(tx, admin);
      await open(tx, paymentId, "before_1", "uz");
      await open(tx, paymentId, "overdue", "kk");
      await become(tx, "postgres");
      const [after] =
        await tx`select * from public.clients where id = ${clientId}`;
      const [auditAfter] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.audit_log where entity_id = ${clientId}
      `;
      return { before, after, audit: audit?.n, auditAfter: auditAfter?.n };
    });
    expect(result.after).toEqual(result.before);
    expect(result.after?.message_locale).toBe("ru");
    expect(result.auditAfter).toBe(result.audit);
  });
});

describe("criterion 4: one event per subscription and kind, whatever the language", () => {
  it("a repeat in another language returns the first event and keeps its template", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { paymentId } = await clientOf(tx, "ru");
      await become(tx, admin);
      const first = await open(tx, paymentId, "before_1", "uz");
      const again = await open(tx, paymentId, "before_1", "kk");
      await become(tx, otherAdmin);
      const other = await open(tx, paymentId, "before_1", null);
      return {
        first,
        again,
        other,
        events: await eventsOf(tx, paymentId),
        uzbek: await templateId(tx, "before_1", "uz"),
      };
    });
    expect(result.first.created).toBe(true);
    expect(result.again).toMatchObject({ id: result.first.id, created: false });
    expect(result.other).toMatchObject({ id: result.first.id, created: false });
    expect(result.events).toEqual([
      { kind: "before_1", template_id: result.uzbek },
    ]);
  });

  it("two languages at the same moment from two connections: still one event", async () => {
    // Committed: each request runs on its own connection. The client is archived, so it stays out
    // of the lists, and the event stays (events are append-only).
    const paymentId = await sql.begin(async (tx) => {
      const clientId = await insertClient(tx, {
        lastName: "Параллельный",
        archived: true,
        phone: `+7701${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      });
      return insertPayment(tx, {
        clientId,
        periodStart: "2026-02-21",
        periodEnd: "2026-03-22",
      });
    });
    const dbs = (["uz", "kk", "ru", null] as const).map((locale) => ({
      locale,
      db: postgres(inject("databaseUrl"), {
        max: 1,
        onnotice: () => undefined,
      }),
    }));
    try {
      const results = await Promise.all(
        dbs.map(({ db, locale }) =>
          db.begin(async (tx) => {
            await become(tx, admin);
            // before_7: no test removes its templates, so this committed event never blocks one.
            return open(tx, paymentId, "before_7", locale);
          }),
        ),
      );
      expect(new Set(results.map((row) => row.id)).size).toBe(1);
      expect(results.filter((row) => row.created)).toHaveLength(1);
    } finally {
      await Promise.all(dbs.map(({ db }) => db.end()));
    }
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.reminder_events where payment_id = ${paymentId}
    `;
    expect(count?.n).toBe(1);
  });
});
