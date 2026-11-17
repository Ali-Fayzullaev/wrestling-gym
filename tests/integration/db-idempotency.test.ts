import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { connectLocalDb } from "./db";
import { insertClient, insertPayment, templateId } from "./support/fixtures";
import { become, rolledBack, SEED_STAFF, type Tx } from "./support/roles";

const sql = connectLocalDb();

// Concurrency needs separate connections and committed rows. Payments cannot be deleted, so the
// fixture client is archived and its period lies in the past: it stays out of the Today counters.
let clientId = "";

beforeAll(async () => {
  clientId = await sql.begin((tx) =>
    insertClient(tx, { lastName: "Идемпотентность", archived: true }),
  );
});

afterAll(async () => {
  await sql.end();
});

function connections(count: number) {
  return Array.from({ length: count }, () =>
    postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
  );
}

/** Inserts a payment as the owner over its own connection, like one browser request. */
function insertAsOwner(db: postgres.Sql, key: string, onConflict: boolean) {
  return db.begin(async (tx) => {
    await become(tx, { userId: SEED_STAFF.owner });
    const conflict = onConflict
      ? tx`on conflict (idempotency_key) do nothing`
      : tx``;
    return tx<{ id: string }[]>`
      insert into public.payments (
        client_id, kind, amount, method, period_start, period_end, idempotency_key, created_by
      ) values (
        ${clientId}, 'payment', 15000, 'cash', '2020-01-01', '2020-01-31', ${key},
        ${SEED_STAFF.owner}
      )
      ${conflict}
      returning id
    `;
  });
}

async function paymentsWithKey(key: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.payments where idempotency_key = ${key}
  `;
  return row?.n ?? -1;
}

describe("criterion 4: one idempotency key, one payment", () => {
  it("two parallel inserts with one key leave exactly one row", async () => {
    const key = randomUUID();
    const dbs = connections(2);
    try {
      const results = await Promise.allSettled(
        dbs.map((db) => insertAsOwner(db, key, false)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
        code: "23505",
      });
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
    expect(await paymentsWithKey(key)).toBe(1);
  });

  it("ten parallel inserts with on conflict do nothing: one row, no errors", async () => {
    const key = randomUUID();
    const dbs = connections(10);
    try {
      const results = await Promise.all(
        dbs.map((db) => insertAsOwner(db, key, true)),
      );
      expect(results.reduce((sum, rows) => sum + rows.length, 0)).toBe(1);
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
    expect(await paymentsWithKey(key)).toBe(1);
  });

  it("a repeated key is rejected even with different payment data", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const key = randomUUID();
        await insertPayment(tx, {
          clientId,
          periodStart: "2020-02-01",
          periodEnd: "2020-02-29",
          idempotencyKey: key,
        });
        await insertPayment(tx, {
          clientId,
          periodStart: "2020-03-01",
          periodEnd: "2020-03-31",
          amount: 20000,
          idempotencyKey: key,
        });
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("step 18 criterion 4: the same key with another last day", () => {
  it("is refused by record_payment() and leaves one payment", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const client = await insertClient(tx);
      const [today] = await tx<{ d: string }[]>`
        select ((now() at time zone 'Asia/Almaty')::date + 40)::text as d
      `;
      await become(tx, { userId: SEED_STAFF.owner });
      const key = randomUUID();
      await tx`select public.record_payment(${client}, 15000, 'cash', ${key}, 1, null)`;
      let error: unknown = null;
      try {
        await tx`savepoint s`;
        await tx`
          select public.record_payment(${client}, 15000, 'cash', ${key}, 1, ${today?.d ?? null}::date)
        `;
      } catch (caught) {
        error = caught;
        await tx`rollback to savepoint s`;
      }
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.payments where idempotency_key = ${key}
      `;
      return { error, rows: row?.n };
    });
    expect(result.error).toMatchObject({
      code: "23505",
      message: "idempotency_conflict",
    });
    expect(result.rows).toBe(1);
  });
});

describe("criterion 5: one reminder per payment and kind", () => {
  async function paymentWithEvent(tx: Tx) {
    const client = await insertClient(tx);
    const paymentId = await insertPayment(tx, {
      clientId: client,
      periodStart: "2026-01-10",
      periodEnd: "2026-02-09",
    });
    const template = await templateId(tx, "before_7");
    const open = () => tx`
      insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
      values (${client}, ${paymentId}, 'before_7', ${template}, ${SEED_STAFF.owner})
    `;
    await open();
    return { paymentId, open };
  }

  it("a repeated insert conflicts", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const { open } = await paymentWithEvent(tx);
        await open();
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("on conflict do nothing keeps exactly one event", async () => {
    const count = await rolledBack(sql, async (tx) => {
      const { paymentId } = await paymentWithEvent(tx);
      const [payment] = await tx<{ client_id: string }[]>`
        select client_id from public.payments where id = ${paymentId}
      `;
      await tx`
        insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
        values (${payment?.client_id ?? null}, ${paymentId}, 'before_7',
                ${await templateId(tx, "before_7")}, ${SEED_STAFF.owner})
        on conflict (payment_id, kind) do nothing
      `;
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.reminder_events where payment_id = ${paymentId}
      `;
      return row?.n;
    });
    expect(count).toBe(1);
  });

  it("another kind for the same payment is a separate event", async () => {
    const count = await rolledBack(sql, async (tx) => {
      const { paymentId } = await paymentWithEvent(tx);
      const [payment] = await tx<{ client_id: string }[]>`
        select client_id from public.payments where id = ${paymentId}
      `;
      await tx`
        insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
        values (${payment?.client_id ?? null}, ${paymentId}, 'before_1',
                ${await templateId(tx, "before_1")}, ${SEED_STAFF.owner})
      `;
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.reminder_events where payment_id = ${paymentId}
      `;
      return row?.n;
    });
    expect(count).toBe(2);
  });
});
