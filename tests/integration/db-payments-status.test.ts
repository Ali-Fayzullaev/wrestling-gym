import { afterAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "./db";
import {
  insertClient,
  insertPayment,
  insertReversal,
} from "./support/fixtures";
import {
  become,
  owner,
  rolledBack,
  SEED_STAFF,
  type Tx,
} from "./support/roles";

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-03-15";

/** Calendar arithmetic on ISO dates, independent of the machine's time zone. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A client whose single payment ends `daysLeft` days after TODAY. */
async function clientEndingIn(tx: Tx, daysLeft: number) {
  const clientId = await insertClient(tx);
  const periodEnd = addDays(TODAY, daysLeft);
  const periodStart = addDays(periodEnd, -29);
  const paymentId = await insertPayment(tx, {
    clientId,
    periodStart,
    periodEnd,
  });
  return { clientId, paymentId, periodStart, periodEnd };
}

type Status = {
  status: string;
  days_left: number | null;
  ends_on: string | null;
};

async function statusOf(
  tx: Tx,
  clientId: string,
  today = TODAY,
): Promise<Status | undefined> {
  const [row] = await tx<Status[]>`
    select status, days_left, to_char(ends_on, 'YYYY-MM-DD') as ends_on
    from public.client_status(${today}::date)
    where client_id = ${clientId}
  `;
  return row;
}

describe("criterion 6: reversal rules", () => {
  it("reverses a payment with the opposite amount", async () => {
    const kinds = await rolledBack(sql, async (tx) => {
      const p = await clientEndingIn(tx, 10);
      await become(tx, owner);
      await insertReversal(tx, { ...p, reversesId: p.paymentId });
      return tx<{ kind: string; amount: number }[]>`
        select kind, amount from public.payments where client_id = ${p.clientId} order by amount desc
      `;
    });
    expect(kinds).toEqual([
      { kind: "payment", amount: 15000 },
      { kind: "reversal", amount: -15000 },
    ]);
  });

  it("cannot reverse a reversal", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const p = await clientEndingIn(tx, 10);
        const reversalId = await insertReversal(tx, {
          ...p,
          reversesId: p.paymentId,
        });
        await insertReversal(tx, {
          ...p,
          reversesId: reversalId,
          amount: 15000,
        });
      }),
    ).rejects.toMatchObject({
      code: "23514",
      message: "a reversal can only cancel a payment",
    });
  });

  it("cannot reverse the same payment twice", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const p = await clientEndingIn(tx, 10);
        await insertReversal(tx, { ...p, reversesId: p.paymentId });
        await insertReversal(tx, { ...p, reversesId: p.paymentId });
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it.each([-14999, -15001, -1])(
    "rejects a reversal amount of %i for a 15000 payment",
    async (amount) => {
      await expect(
        rolledBack(sql, async (tx) => {
          const p = await clientEndingIn(tx, 10);
          await insertReversal(tx, { ...p, reversesId: p.paymentId, amount });
        }),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );

  it.each([
    ["zero payment", 0],
    ["negative payment", -100],
  ])("rejects a %s", async (_name, amount) => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await insertPayment(tx, {
          clientId,
          periodStart: TODAY,
          periodEnd: TODAY,
          amount,
        });
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["without a reason", null],
    ["with a blank reason", "   "],
  ])("rejects a reversal %s", async (_name, reason) => {
    await expect(
      rolledBack(sql, async (tx) => {
        const p = await clientEndingIn(tx, 10);
        await insertReversal(tx, { ...p, reversesId: p.paymentId, reason });
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a reversal with a different period", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const p = await clientEndingIn(tx, 10);
        await insertReversal(tx, {
          ...p,
          periodEnd: addDays(p.periodEnd, 1),
          reversesId: p.paymentId,
        });
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a reversal filed under another client", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const p = await clientEndingIn(tx, 10);
        const other = await insertClient(tx);
        await insertReversal(tx, {
          ...p,
          clientId: other,
          reversesId: p.paymentId,
        });
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a period that ends before it starts", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        await insertPayment(tx, {
          clientId,
          periodStart: TODAY,
          periodEnd: addDays(TODAY, -1),
        });
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("criterion 7: client_status on a fixed date", () => {
  it.each([
    [8, "active"],
    [7, "expiring"],
    [1, "expiring"],
    [0, "expiring"],
    [-1, "expired"],
    [-30, "expired"],
  ])("%i days left -> %s", async (daysLeft, expected) => {
    const status = await rolledBack(sql, async (tx) => {
      const { clientId } = await clientEndingIn(tx, daysLeft);
      await become(tx, owner);
      return statusOf(tx, clientId);
    });
    expect(status).toEqual({
      status: expected,
      days_left: daysLeft,
      ends_on: addDays(TODAY, daysLeft),
    });
  });

  it("a client without payments has status none", async () => {
    const status = await rolledBack(sql, async (tx) =>
      statusOf(tx, await insertClient(tx)),
    );
    expect(status).toEqual({ status: "none", days_left: null, ends_on: null });
  });

  it("the latest period wins", async () => {
    const status = await rolledBack(sql, async (tx) => {
      const p = await clientEndingIn(tx, -1);
      await insertPayment(tx, {
        clientId: p.clientId,
        periodStart: addDays(p.periodEnd, 1),
        periodEnd: addDays(p.periodEnd, 30),
      });
      return statusOf(tx, p.clientId);
    });
    expect(status).toEqual({
      status: "active",
      days_left: 29,
      ends_on: addDays(TODAY, 29),
    });
  });

  it("a reversed payment does not extend the subscription", async () => {
    const status = await rolledBack(sql, async (tx) => {
      const p = await clientEndingIn(tx, 3);
      const next = {
        clientId: p.clientId,
        periodStart: addDays(p.periodEnd, 1),
        periodEnd: addDays(p.periodEnd, 30),
      };
      const extraId = await insertPayment(tx, next);
      await insertReversal(tx, { ...next, reversesId: extraId });
      return statusOf(tx, p.clientId);
    });
    expect(status).toEqual({
      status: "expiring",
      days_left: 3,
      ends_on: addDays(TODAY, 3),
    });
  });

  it("a client whose only payment was reversed has status none", async () => {
    const status = await rolledBack(sql, async (tx) => {
      const p = await clientEndingIn(tx, 20);
      await insertReversal(tx, { ...p, reversesId: p.paymentId });
      return statusOf(tx, p.clientId);
    });
    expect(status?.status).toBe("none");
  });

  it("the default date is today in Asia/Almaty", async () => {
    const [row] = await rolledBack(
      sql,
      (tx) => tx<{ same: boolean }[]>`
      select (select count(*) from public.client_status_v)
           = (select count(*) from public.client_status((now() at time zone 'Asia/Almaty')::date))
         and not exists (
           select * from public.client_status_v
           except
           select * from public.client_status((now() at time zone 'Asia/Almaty')::date)
         ) as same
    `,
    );
    expect(row?.same).toBe(true);
  });
});

describe("reminder_kind_for", () => {
  it.each([
    [7, "{7,1}", "before_7"],
    [1, "{7,1}", "before_1"],
    [0, "{7,1}", "overdue"],
    [3, "{7,1}", null],
    [-1, "{7,1}", null],
    [5, "{2,5}", "before_7"],
    [2, "{2,5}", "before_1"],
    [3, "{3}", "before_7"],
  ])("%i days left with %s -> %s", async (daysLeft, days, expected) => {
    const [row] = await rolledBack(
      sql,
      (tx) => tx<{ kind: string | null }[]>`
      select public.reminder_kind_for(${daysLeft}, ${days}::int[]) as kind
    `,
    );
    expect(row?.kind).toBe(expected);
  });
});

describe("dashboard_counts on a fixed date", () => {
  /** Hides seed clients so the counters only see this test's fixtures. */
  async function onlyFixtures(tx: Tx) {
    await tx`update public.clients set archived_at = now() where archived_at is null`;
  }

  it("counts reminders due, debtors, expiring and paid today", async () => {
    const counts = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      await clientEndingIn(tx, 8); // active, nothing due
      await clientEndingIn(tx, 7); // expiring, before_7 due
      const opened = await clientEndingIn(tx, 1); // expiring, before_1 due but already opened
      await clientEndingIn(tx, 0); // expiring, overdue reminder due
      await clientEndingIn(tx, -1); // expired
      await clientEndingIn(tx, -5); // expired
      await insertClient(tx); // none
      await tx`
        insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
        select ${opened.clientId}, ${opened.paymentId}, 'before_1', t.id, ${SEED_STAFF.owner}
        from public.message_templates t where t.kind = 'before_1' and t.locale = 'ru'
      `;

      // Paid today in Almaty: 00:30 local counts, 23:30 the evening before does not.
      const paidAt = async (instant: string) => {
        const clientId = await insertClient(tx);
        await insertPayment(tx, {
          clientId,
          periodStart: TODAY,
          periodEnd: addDays(TODAY, 29),
          createdAt: new Date(instant),
        });
        return clientId;
      };
      await paidAt("2026-03-14T19:30:00Z"); // 00:30 on 15 March in Almaty
      await paidAt("2026-03-14T18:30:00Z"); // 23:30 on 14 March in Almaty

      // A payment made today and reversed is not "paid today".
      const reversedClient = await insertClient(tx);
      const period = {
        clientId: reversedClient,
        periodStart: TODAY,
        periodEnd: addDays(TODAY, 29),
      };
      const reversedId = await insertPayment(tx, {
        ...period,
        createdAt: new Date("2026-03-15T06:00:00Z"),
      });
      await insertReversal(tx, { ...period, reversesId: reversedId });

      await become(tx, owner);
      const [row] =
        await tx`select * from public.dashboard_counts(${TODAY}::date)`;
      return row;
    });

    expect(counts).toEqual({
      remind_today: 2,
      debtors: 2,
      expiring_week: 3,
      paid_today: 1,
    });
  });

  it("archived clients are not counted", async () => {
    const counts = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const { clientId } = await clientEndingIn(tx, -3);
      await tx`update public.clients set archived_at = now() where id = ${clientId}`;
      const [row] =
        await tx`select debtors from public.dashboard_counts(${TODAY}::date)`;
      return row;
    });
    expect(counts).toEqual({ debtors: 0 });
  });
});
