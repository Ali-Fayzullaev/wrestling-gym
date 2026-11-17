import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  nextPeriod,
  periodEnd,
  periodEndBounds,
} from "@/features/payments/period";

import { connectLocalDb } from "./db";
import { insertClient, insertPayment } from "./support/fixtures";
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

afterAll(async () => {
  await sql.end();
});

type Recorded = {
  id: string;
  client_id: string;
  kind: string;
  amount: number;
  period_start: string;
  period_end: string;
  reverses_id: string | null;
  created: boolean;
};

async function record(
  tx: Tx,
  clientId: string,
  key: string,
  overrides: { amount?: number; method?: string; periodEnd?: string } = {},
): Promise<Recorded> {
  const [row] = await tx<{ r: Recorded }[]>`
    select public.record_payment(
      ${clientId}, ${overrides.amount ?? 15000}, ${overrides.method ?? "cash"}, ${key},
      1, ${overrides.periodEnd ?? null}::date
    ) as r
  `;
  if (!row) throw new Error("record_payment returned nothing");
  return row.r;
}

async function reverse(
  tx: Tx,
  paymentId: string,
  reason: string,
  key = randomUUID(),
) {
  const [row] = await tx<{ r: Recorded }[]>`
    select public.reverse_payment(${paymentId}, ${reason}, ${key}) as r
  `;
  if (!row) throw new Error("reverse_payment returned nothing");
  return row.r;
}

async function cancel(tx: Tx, paymentId: string, key = randomUUID()) {
  const [row] = await tx<{ r: Recorded }[]>`
    select public.cancel_recent_payment(${paymentId}, ${key}) as r
  `;
  if (!row) throw new Error("cancel_recent_payment returned nothing");
  return row.r;
}

async function serverToday(tx: Tx): Promise<string> {
  const [row] = await tx<{ d: string }[]>`
    select ((now() at time zone 'Asia/Almaty')::date)::text as d
  `;
  if (!row) throw new Error("no date");
  return row.d;
}

async function status(tx: Tx, clientId: string) {
  const [row] = await tx<{ status: string; ends_on: string | null }[]>`
    select status, ends_on::text from public.client_status() where client_id = ${clientId}
  `;
  return row;
}

async function count(
  tx: Tx | postgres.Sql,
  clientId: string,
  kind = "payment",
) {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.payments where client_id = ${clientId} and kind = ${kind}
  `;
  return row?.n ?? -1;
}

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe("criterion 2: next_period() in SQL equals nextPeriod() in the form (D-03)", () => {
  const cases: [string | null, string][] = [
    [null, "2026-11-17"],
    ["2026-12-16", "2026-12-10"],
    ["2026-12-16", "2026-12-22"],
    ["2026-09-16", "2026-12-22"],
    ["2026-12-16", "2027-01-16"],
    ["2026-12-16", "2027-01-17"],
    ["2026-01-30", "2026-02-28"],
    ["2026-01-30", "2026-03-01"],
    ["2026-12-20", "2027-01-05"],
    [null, "2026-11-19"],
    ["2026-11-25", "2026-11-19"],
    ["2026-11-19", "2026-11-19"],
    ["2026-11-18", "2026-11-19"],
    [null, "2026-01-31"],
    [null, "2028-01-31"],
    [null, "2026-01-29"],
    [null, "2028-01-29"],
    ["2026-02-28", "2026-02-20"],
    [null, "2026-03-31"],
    [null, "2026-12-15"],
    [null, "2026-12-31"],
    ["2026-12-31", "2026-12-28"],
  ];

  it.each(cases)("current end %s, paid on %s", async (currentEnd, paidOn) => {
    const [row] = await sql<{ period_start: string; period_end: string }[]>`
      select period_start::text, period_end::text
      from public.next_period(${currentEnd}::date, ${paidOn}::date, 1)
    `;
    expect({ start: row?.period_start, end: row?.period_end }).toEqual(
      nextPeriod(currentEnd, paidOn),
    );
  });

  it.each([
    ["2026-01-31", 1],
    ["2026-01-15", 12],
    ["2027-12-31", 2],
    ["2028-02-29", 12],
  ] as const)(
    "period_last_day(%s, %i) equals periodEnd()",
    async (start, months) => {
      const [row] = await sql<{ d: string }[]>`
      select public.period_last_day(${start}::date, ${months})::text as d
    `;
      expect(row?.d).toBe(periodEnd(start, months));
    },
  );

  it.each([
    ["2026-12-17", "2026-12-22"],
    ["2026-12-17", "2026-12-10"],
    ["2028-02-29", "2028-02-29"],
  ])(
    "period_end_bounds(%s, %s) equals periodEndBounds()",
    async (start, paidOn) => {
      const [row] = await sql<{ min: string; max: string }[]>`
      select min_end::text as min, max_end::text as max
      from public.period_end_bounds(${start}::date, ${paidOn}::date)
    `;
      expect(row).toEqual(periodEndBounds(start, paidOn));
    },
  );
});

describe("record_payment()", () => {
  it("records a payment from today for a client without one, with an audit row free of personal data", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      await become(tx, admin);
      const today = await serverToday(tx);
      const payment = await record(tx, clientId, randomUUID(), {
        method: "kaspi",
      });
      await become(tx, "postgres");
      const [audit] = await tx<
        { actor_id: string; details: Record<string, unknown> }[]
      >`
        select actor_id, details from public.audit_log
        where action = 'payment.create' and entity_id = ${payment.id}
      `;
      const [stored] = await tx<{ created_by: string; method: string }[]>`
        select created_by, method from public.payments where id = ${payment.id}
      `;
      return { today, payment, audit, stored, clientId };
    });
    expect(result.payment).toMatchObject({
      kind: "payment",
      amount: 15000,
      created: true,
      ...(() => {
        const p = nextPeriod(null, result.today);
        return { period_start: p.start, period_end: p.end };
      })(),
    });
    expect(result.stored).toEqual({
      created_by: SEED_STAFF.admin,
      method: "kaspi",
    });
    expect(result.audit?.actor_id).toBe(SEED_STAFF.admin);
    expect(Object.keys(result.audit?.details ?? {}).sort()).toEqual([
      "amount",
      "client_id",
      "method",
      "period_end",
      "period_start",
    ]);
  });

  it("extends a valid subscription from the day after its end", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      const today = await serverToday(tx);
      await insertPayment(tx, {
        clientId,
        periodStart: addDays(today, -20),
        periodEnd: addDays(today, 10),
      });
      await become(tx, owner);
      return { today, payment: await record(tx, clientId, randomUUID()) };
    });
    expect(result.payment.period_start).toBe(addDays(result.today, 11));
  });

  it("D-03: paid 6 days late, the period continues from the old end", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      const today = await serverToday(tx);
      const oldEnd = addDays(today, -6);
      await insertPayment(tx, {
        clientId,
        periodStart: addDays(oldEnd, -29),
        periodEnd: oldEnd,
      });
      await become(tx, admin);
      return { oldEnd, payment: await record(tx, clientId, randomUUID()) };
    });
    const expected = nextPeriod(result.oldEnd, addDays(result.oldEnd, 6));
    expect(result.payment.period_start).toBe(addDays(result.oldEnd, 1));
    expect(result.payment.period_end).toBe(expected.end);
  });

  it("D-03: an imported subscription that ended a few days ago is continued too", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      const today = await serverToday(tx);
      const oldEnd = addDays(today, -3);
      await tx`
        insert into public.payments (
          client_id, kind, amount, method, period_start, period_end, reason, idempotency_key,
          created_by
        ) values (
          ${clientId}, 'import_balance', 0, null, ${addDays(oldEnd, -29)}, ${oldEnd},
          'Перенос из тетради', ${randomUUID()}, ${SEED_STAFF.owner}
        )
      `;
      await become(tx, admin);
      return { oldEnd, payment: await record(tx, clientId, randomUUID()) };
    });
    expect(result.payment.period_start).toBe(addDays(result.oldEnd, 1));
  });

  it("D-03: away longer than a month, the period starts today", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      const today = await serverToday(tx);
      await insertPayment(tx, {
        clientId,
        periodStart: addDays(today, -120),
        periodEnd: addDays(today, -90),
      });
      await become(tx, owner);
      return { today, payment: await record(tx, clientId, randomUUID()) };
    });
    expect(result.payment.period_start).toBe(result.today);
  });

  it("criterion 2: a resubmission with the same key returns the same payment, no second row", async () => {
    const result = await asActor(sql, admin, async (tx) => {
      await become(tx, "postgres");
      const clientId = await insertClient(tx);
      await become(tx, admin);
      const key = randomUUID();
      const first = await record(tx, clientId, key);
      const second = await record(tx, clientId, key);
      return { first, second, rows: await count(tx, clientId) };
    });
    expect(result.second.id).toBe(result.first.id);
    expect(result.first.created).toBe(true);
    expect(result.second.created).toBe(false);
    expect(result.rows).toBe(1);
  });

  it("the same key with a different amount or client is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await become(tx, owner);
        const key = randomUUID();
        await record(tx, clientId, key);
        await record(tx, clientId, key, { amount: 20000 });
      }),
    ).rejects.toMatchObject({ code: "23505", message: "idempotency_conflict" });

    await expect(
      rolledBack(sql, async (tx) => {
        const first = await insertClient(tx);
        const second = await insertClient(tx);
        await become(tx, owner);
        const key = randomUUID();
        await record(tx, first, key);
        await record(tx, second, key);
      }),
    ).rejects.toMatchObject({ message: "idempotency_conflict" });
  });

  it("criterion 7: an amount of zero or less is refused", async () => {
    for (const amount of [0, -15000]) {
      await expect(
        rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          await become(tx, admin);
          await record(tx, clientId, randomUUID(), { amount });
        }),
      ).rejects.toMatchObject({ code: "22023", message: "invalid_payment" });
    }
  });

  it("an unknown method is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await become(tx, admin);
        await record(tx, clientId, randomUUID(), { method: "card" });
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("a deleted client (personal data blanked) takes no payment", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await insertPayment(tx, {
          clientId,
          periodStart: "2026-01-10",
          periodEnd: "2026-02-09",
        });
        await become(tx, owner);
        await tx`select public.delete_client(${clientId}, 'client_request', 'Тестовый')`;
        await record(tx, clientId, randomUUID());
      }),
    ).rejects.toMatchObject({ code: "P0002", message: "client_not_found" });
  });

  it("a deleted client takes no payment by a direct insert either", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await insertPayment(tx, {
          clientId,
          periodStart: "2026-01-10",
          periodEnd: "2026-02-09",
        });
        await become(tx, owner);
        await tx`select public.delete_client(${clientId}, 'client_request', 'Тестовый')`;
        await insertPayment(tx, {
          clientId,
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
        });
      }),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("an unknown client is refused", async () => {
    await expect(
      asActor(sql, admin, (tx) => record(tx, randomUUID(), randomUUID())),
    ).rejects.toMatchObject({ code: "P0002", message: "client_not_found" });
  });

  it("anon and an inactive employee are refused", async () => {
    const clientId = "20000000-0000-4000-8000-000000000001";
    await expect(
      asActor(sql, "anon", (tx) => record(tx, clientId, randomUUID())),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rolledBack(sql, async (tx) => {
        await tx`update public.staff set active = false where id = ${SEED_STAFF.otherAdmin}`;
        await become(tx, otherAdmin);
        await record(tx, clientId, randomUUID());
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("criterion 3: ten parallel requests with one key", () => {
  let clientId = "";

  beforeAll(async () => {
    // Committed: each request runs on its own connection. Payments cannot be deleted, so the client
    // is archived and stays out of the lists and counters.
    clientId = await sql.begin((tx) =>
      insertClient(tx, { lastName: "Параллельный", archived: true }),
    );
  });

  it("leave exactly one payment, and every request gets it back", async () => {
    const key = randomUUID();
    const dbs = Array.from({ length: 10 }, () =>
      postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
    );
    try {
      const results = await Promise.all(
        dbs.map((db) =>
          db.begin(async (tx) => {
            await become(tx, admin);
            return record(tx, clientId, key);
          }),
        ),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
    }
    expect(await count(sql, clientId)).toBe(1);
  });
});

describe("criterion 4: a payment cannot be edited or deleted, not even by the owner", () => {
  it.each([
    [
      "update",
      (tx: Tx, id: string) =>
        tx`update public.payments set amount = 1 where id = ${id}`,
    ],
    [
      "delete",
      (tx: Tx, id: string) => tx`delete from public.payments where id = ${id}`,
    ],
  ] as const)("%s fails in the database", async (_, change) => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await become(tx, owner);
        const payment = await record(tx, clientId, randomUUID());
        await change(tx, payment.id);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("the append-only trigger stops the table owner too", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const id = await insertPayment(tx, {
          clientId,
          periodStart: "2026-01-10",
          periodEnd: "2026-02-09",
        });
        await tx`update public.payments set amount = 1 where id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });
});

describe("criterion 5: cancel right away", () => {
  async function paymentAgo(
    tx: Tx,
    minutes: number,
    createdBy: string = SEED_STAFF.admin,
  ) {
    const clientId = await insertClient(tx);
    const id = await insertPayment(tx, {
      clientId,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      createdBy,
      createdAt: new Date(Date.now() - minutes * 60_000),
    });
    return { clientId, id };
  }

  it("within 10 minutes the author cancels: a reversal «Отменено сразу»", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { id } = await paymentAgo(tx, 9);
      await become(tx, admin);
      const reversal = await cancel(tx, id);
      await become(tx, "postgres");
      const [row] = await tx<
        { reason: string; amount: number; created_by: string }[]
      >`
        select reason, amount, created_by from public.payments where id = ${reversal.id}
      `;
      const [audit] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.audit_log
        where action = 'payment.cancel' and entity_id = ${reversal.id}
      `;
      return { reversal, row, audit: audit?.n, id };
    });
    expect(result.reversal).toMatchObject({
      kind: "reversal",
      reverses_id: result.id,
    });
    expect(result.row).toEqual({
      reason: "Отменено сразу",
      amount: -15000,
      created_by: SEED_STAFF.admin,
    });
    expect(result.audit).toBe(1);
  });

  it("after 11 minutes the author is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const { id } = await paymentAgo(tx, 11);
        await become(tx, admin);
        await cancel(tx, id);
      }),
    ).rejects.toMatchObject({ code: "22023", message: "cancel_window_passed" });
  });

  it("after 11 minutes the owner cannot cancel either (only a reversal with a reason)", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const { id } = await paymentAgo(tx, 11);
        await become(tx, owner);
        await cancel(tx, id);
      }),
    ).rejects.toMatchObject({ message: "cancel_window_passed" });
  });

  it("the owner may cancel another employee's payment within 10 minutes", async () => {
    const reversal = await rolledBack(sql, async (tx) => {
      const { id } = await paymentAgo(tx, 2);
      await become(tx, owner);
      return cancel(tx, id);
    });
    expect(reversal.kind).toBe("reversal");
  });

  it("another admin may not cancel it", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const { id } = await paymentAgo(tx, 2);
        await become(tx, otherAdmin);
        await cancel(tx, id);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a repeated cancel with the same key returns the same reversal; with a new key it is refused", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const { id } = await paymentAgo(tx, 1);
      await become(tx, admin);
      const key = randomUUID();
      const first = await cancel(tx, id, key);
      const second = await cancel(tx, id, key);
      let again: unknown = null;
      try {
        await tx`savepoint s`;
        await cancel(tx, id);
      } catch (error) {
        again = error;
        await tx`rollback to savepoint s`;
      }
      return { first, second, again };
    });
    expect(result.second.id).toBe(result.first.id);
    expect(result.second.created).toBe(false);
    expect(result.again).toMatchObject({ message: "already_reversed" });
  });
});

describe("reverse_payment()", () => {
  it("only the owner reverses, with a reason; an admin is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const id = await insertPayment(tx, {
          clientId,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          createdBy: SEED_STAFF.admin,
        });
        await become(tx, admin);
        await reverse(tx, id, "Ошибка");
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("an empty reason is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const id = await insertPayment(tx, {
          clientId,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
        });
        await become(tx, owner);
        await reverse(tx, id, "   ");
      }),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_reversal" });
  });

  it("a payment is reversed once; a reversal cannot be reversed", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const id = await insertPayment(tx, {
          clientId,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
        });
        await become(tx, owner);
        await reverse(tx, id, "Ошибка");
        await reverse(tx, id, "Ещё раз");
      }),
    ).rejects.toMatchObject({ message: "already_reversed" });

    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const id = await insertPayment(tx, {
          clientId,
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
        });
        await become(tx, owner);
        const reversal = await reverse(tx, id, "Ошибка");
        await reverse(tx, reversal.id, "Сторно сторно");
      }),
    ).rejects.toMatchObject({ code: "P0002", message: "payment_not_found" });
  });

  it("criterion 6: after a reversal client_status returns to the previous state", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      const today = await serverToday(tx);
      const oldEnd = addDays(today, -3);
      await insertPayment(tx, {
        clientId,
        periodStart: addDays(oldEnd, -29),
        periodEnd: oldEnd,
      });
      await become(tx, owner);
      const before = await status(tx, clientId);
      const payment = await record(tx, clientId, randomUUID());
      const paid = await status(tx, clientId);
      await reverse(tx, payment.id, "Отмечено не тому клиенту");
      const after = await status(tx, clientId);
      return { before, paid, after, oldEnd };
    });
    expect(result.before).toEqual({
      status: "expired",
      ends_on: result.oldEnd,
    });
    expect(result.paid?.status).toBe("active");
    expect(result.after).toEqual(result.before);
  });

  it("criterion 7: a reversal of zero or a positive amount is refused by the table", async () => {
    for (const amount of [0, 15000]) {
      await expect(
        rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          const id = await insertPayment(tx, {
            clientId,
            periodStart: "2026-11-01",
            periodEnd: "2026-11-30",
          });
          await become(tx, owner);
          await tx`
            insert into public.payments (
              client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
              idempotency_key, created_by
            ) values (
              ${clientId}, 'reversal', ${amount}, 'cash', '2026-11-01', '2026-11-30', ${id},
              'Ошибка', ${randomUUID()}, ${SEED_STAFF.owner}
            )
          `;
        }),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });
});

describe("client_screen() carries the payment history and the group price", () => {
  it("payments and reversals with who recorded them", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      await become(tx, owner);
      const payment = await record(tx, clientId, randomUUID());
      await reverse(tx, payment.id, "Ошибка");
      await become(tx, admin);
      const [row] = await tx<
        {
          s: { payments: Record<string, unknown>[]; group: { price: number } };
        }[]
      >`
        select public.client_screen(${clientId}) as s
      `;
      return row?.s;
    });
    expect(screen?.group.price).toBeGreaterThan(0);
    expect(screen?.payments).toHaveLength(2);
    expect(screen?.payments.map((p) => p.kind).sort()).toEqual([
      "payment",
      "reversal",
    ]);
    expect(screen?.payments[0]).toHaveProperty("created_by_name");
  });
});

describe("D-16: last day chosen when recording a payment", () => {
  type Audit = { details: Record<string, unknown> };

  async function auditOf(tx: Tx, paymentId: string) {
    await become(tx, "postgres");
    const [row] = await tx<Audit[]>`
      select details from public.audit_log
      where action = 'payment.create' and entity_id = ${paymentId}
    `;
    return row?.details;
  }

  it("criteria 3, 5, 6: an admin sets the date; it is stored and the journal keeps the default one, no personal data", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx, {
        lastName: "Секретов",
        phone: "+77015550199",
      });
      const today = await serverToday(tx);
      const rule = nextPeriod(null, today);
      const chosen = addDays(rule.end, 14);
      await become(tx, admin);
      const payment = await record(tx, clientId, randomUUID(), {
        periodEnd: chosen,
      });
      const details = await auditOf(tx, payment.id);
      const status = await (async () => {
        const [row] = await tx<{ status: string; ends_on: string }[]>`
          select status, ends_on::text from public.client_status() where client_id = ${clientId}
        `;
        return row;
      })();
      return { rule, chosen, payment, details, status };
    });
    expect(result.payment.period_start).toBe(result.rule.start);
    expect(result.payment.period_end).toBe(result.chosen);
    expect(result.status).toEqual({ status: "active", ends_on: result.chosen });
    expect(result.details).toMatchObject({
      period_end: result.chosen,
      period_end_changed: true,
      rule_period_end: result.rule.end,
    });
    const text = JSON.stringify(result.details);
    expect(text).not.toContain("Секретов");
    expect(text).not.toContain("7015550199");
  });

  it("the default date sent explicitly is not marked as changed", async () => {
    const details = await rolledBack(sql, async (tx) => {
      const clientId = await insertClient(tx);
      const rule = nextPeriod(null, await serverToday(tx));
      await become(tx, owner);
      const payment = await record(tx, clientId, randomUUID(), {
        periodEnd: rule.end,
      });
      return auditOf(tx, payment.id);
    });
    expect(details).not.toHaveProperty("period_end_changed");
    expect(details).not.toHaveProperty("rule_period_end");
  });

  it("criterion 3: the bounds themselves are accepted", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const first = await insertClient(tx);
      const second = await insertClient(tx);
      const today = await serverToday(tx);
      const bounds = periodEndBounds(today, today);
      await become(tx, admin);
      return {
        bounds,
        first: await record(tx, first, randomUUID(), { periodEnd: bounds.min }),
        second: await record(tx, second, randomUUID(), {
          periodEnd: bounds.max,
        }),
      };
    });
    expect(result.first.period_end).toBe(result.bounds.min);
    expect(result.second.period_end).toBe(result.bounds.max);
  });

  it.each([
    ["the day before the payment day", (today: string) => addDays(today, -1)],
    [
      "a day past 12 months from the start",
      (today: string) => addDays(periodEnd(today, 12), 1),
    ],
  ])(
    "criterion 3: %s is refused by the database (22023), nothing stored",
    async (_, pick) => {
      await expect(
        rolledBack(sql, async (tx) => {
          const clientId = await insertClient(tx);
          const today = await serverToday(tx);
          await become(tx, admin);
          await record(tx, clientId, randomUUID(), { periodEnd: pick(today) });
        }),
      ).rejects.toMatchObject({
        code: "22023",
        message: "period_end_out_of_range",
      });
    },
  );

  it("paid in advance: a date before the start of the new period is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const today = await serverToday(tx);
        await insertPayment(tx, {
          clientId,
          periodStart: addDays(today, -20),
          periodEnd: addDays(today, 10),
        });
        await become(tx, owner);
        await record(tx, clientId, randomUUID(), {
          periodEnd: addDays(today, 5),
        });
      }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("criterion 6: anon and an inactive employee are refused with a date too", async () => {
    const clientId = "20000000-0000-4000-8000-000000000001";
    const periodEndDate = addDays(new Date().toISOString().slice(0, 10), 40);
    await expect(
      asActor(sql, "anon", (tx) =>
        record(tx, clientId, randomUUID(), { periodEnd: periodEndDate }),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rolledBack(sql, async (tx) => {
        await tx`update public.staff set active = false where id = ${SEED_STAFF.otherAdmin}`;
        await become(tx, otherAdmin);
        await record(tx, clientId, randomUUID(), { periodEnd: periodEndDate });
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("the five-argument signature from step 07 is gone: no stale overload", async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_payment'
    `;
    expect(row?.n).toBe(1);
  });
});
