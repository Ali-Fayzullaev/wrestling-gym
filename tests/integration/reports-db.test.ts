import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "./db";
import { testPhone } from "./support/fixtures";
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

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const OTHER_GROUP = "10000000-0000-4000-8000-000000000002";
// Seeds are built around today (2026 and later); this month holds only this file's fixtures.
const MONTH = "2025-01-01";

type MoneyCount = { amount: number; count: number };
type Report = {
  total: MoneyCount;
  reversed: MoneyCount;
  by_method: (MoneyCount & { method: string })[];
  by_group: (MoneyCount & { group_id: string | null; name: string | null })[];
  debtors: {
    group_id: string | null;
    name: string | null;
    price: number | null;
    count: number;
    expected: number | null;
    clients: { id: string; last_name: string; ends_on: string | null }[];
  }[];
};

async function addClient(
  tx: Tx,
  options: {
    groupId?: string | null;
    lastName?: string;
    archived?: boolean;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.clients (
      id, last_name, first_name, phone, group_id, started_on, archived_at, created_by
    ) values (
      ${id}, ${options.lastName ?? "Отчётов"}, 'Клиент', ${testPhone()},
      ${options.groupId === undefined ? SEED_GROUP : options.groupId}, '2024-12-01',
      ${options.archived ? new Date("2025-01-02T00:00:00Z") : null}, ${SEED_STAFF.owner}
    )
  `;
  return id;
}

async function addPayment(
  tx: Tx,
  input: {
    clientId: string;
    amount: number;
    method?: "cash" | "kaspi" | "transfer";
    /** UTC instant; Almaty is UTC+5. */
    at: string;
    periodStart?: string;
    periodEnd?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.payments (
      id, client_id, kind, amount, method, period_start, period_end, idempotency_key,
      created_by, created_at
    ) values (
      ${id}, ${input.clientId}, 'payment', ${input.amount}, ${input.method ?? "cash"},
      ${input.periodStart ?? "2025-01-10"}, ${input.periodEnd ?? "2025-02-09"}, ${randomUUID()},
      ${SEED_STAFF.admin}, ${new Date(input.at)}
    )
  `;
  return id;
}

async function reverse(tx: Tx, paymentId: string, at: string): Promise<void> {
  await tx`
    insert into public.payments (
      client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
      idempotency_key, created_by, created_at
    )
    select client_id, 'reversal', -amount, method, period_start, period_end, id,
           'Ошибочная отметка', ${randomUUID()}, ${SEED_STAFF.owner}, ${new Date(at)}
    from public.payments where id = ${paymentId}
  `;
}

async function addOpeningBalance(tx: Tx, clientId: string, at: string) {
  await tx`
    insert into public.payments (
      client_id, kind, amount, method, period_start, period_end, reason, idempotency_key,
      created_by, created_at
    ) values (
      ${clientId}, 'import_balance', 0, null, '2025-01-01', '2025-01-31', 'Перенос из тетради',
      ${randomUUID()}, ${SEED_STAFF.owner}, ${new Date(at)}
    )
  `;
}

async function reportAsOwner(
  tx: Tx,
  month = MONTH,
  today = "2025-01-20",
): Promise<Report> {
  await become(tx, owner);
  const [row] = await tx<{ report: Report }[]>`
    select public.report_month(${month}::date, ${today}::date) as report
  `;
  await become(tx, "postgres");
  if (!row) throw new Error("no report");
  return row.report;
}

/** Hides seed clients so debtors only come from this test's fixtures. */
async function onlyFixtureClients(tx: Tx) {
  await tx`update public.clients set archived_at = now() where archived_at is null`;
}

describe("report_month: money of a month", () => {
  it("criterion 1: sums by month, method and group match a hand count; reversals and opening balances do not count", async () => {
    await rolledBack(sql, async (tx) => {
      const a = await addClient(tx);
      const b = await addClient(tx, { groupId: OTHER_GROUP });
      const c = await addClient(tx, { groupId: null });

      // January in Almaty: 15 000 cash + 20 000 kaspi (group 1), 18 000 transfer (group 2),
      // 7 000 cash (no group). 12 000 kaspi of group 2 is reversed. Hand count: 60 000 in 4.
      await addPayment(tx, {
        clientId: a,
        amount: 15000,
        method: "cash",
        at: "2025-01-05T05:00:00Z",
      });
      await addPayment(tx, {
        clientId: a,
        amount: 20000,
        method: "kaspi",
        at: "2025-01-10T05:00:00Z",
      });
      await addPayment(tx, {
        clientId: b,
        amount: 18000,
        method: "transfer",
        at: "2025-01-12T05:00:00Z",
      });
      await addPayment(tx, {
        clientId: c,
        amount: 7000,
        method: "cash",
        at: "2025-01-15T05:00:00Z",
      });
      const mistaken = await addPayment(tx, {
        clientId: b,
        amount: 12000,
        method: "kaspi",
        at: "2025-01-20T05:00:00Z",
        periodStart: "2025-02-10",
        periodEnd: "2025-03-09",
      });
      // Reversed in February: still out of January, since that money never came in.
      await reverse(tx, mistaken, "2025-02-02T05:00:00Z");
      // An opening balance from the import is not money.
      await addOpeningBalance(tx, c, "2025-01-16T05:00:00Z");
      // Neighbouring months.
      await addPayment(tx, {
        clientId: a,
        amount: 99000,
        at: "2024-12-31T12:00:00Z",
      });
      await addPayment(tx, {
        clientId: a,
        amount: 98000,
        at: "2025-02-01T12:00:00Z",
      });

      const report = await reportAsOwner(tx);
      expect(report.total).toEqual({ amount: 60000, count: 4 });
      expect(report.reversed).toEqual({ amount: 12000, count: 1 });
      expect(report.by_method).toEqual([
        { method: "cash", amount: 22000, count: 2 },
        { method: "kaspi", amount: 20000, count: 1 },
        { method: "transfer", amount: 18000, count: 1 },
      ]);
      expect(
        report.by_group.map((g) => [g.group_id, g.amount, g.count]),
      ).toEqual([
        [SEED_GROUP, 35000, 2],
        [OTHER_GROUP, 18000, 1],
        [null, 7000, 1],
      ]);
      expect(report.by_group[0]?.name).toBeTruthy();
    });
  });

  it("criterion 1: a reversal lowers the month's total", async () => {
    await rolledBack(sql, async (tx) => {
      const a = await addClient(tx);
      const first = await addPayment(tx, {
        clientId: a,
        amount: 15000,
        at: "2025-01-05T05:00:00Z",
      });
      await addPayment(tx, {
        clientId: a,
        amount: 15000,
        at: "2025-01-06T05:00:00Z",
        periodStart: "2025-02-10",
        periodEnd: "2025-03-09",
      });
      expect((await reportAsOwner(tx)).total).toEqual({
        amount: 30000,
        count: 2,
      });

      await reverse(tx, first, "2025-01-05T05:05:00Z");
      const after = await reportAsOwner(tx);
      expect(after.total).toEqual({ amount: 15000, count: 1 });
      expect(after.reversed).toEqual({ amount: 15000, count: 1 });
    });
  });

  it("criterion 1: a payment at 23:30 Almaty on the last day is in that month, 00:30 the next day is not", async () => {
    await rolledBack(sql, async (tx) => {
      const a = await addClient(tx);
      // 30 November 2025, 23:30 Almaty = 18:30 UTC.
      await addPayment(tx, {
        clientId: a,
        amount: 11000,
        at: "2025-11-30T18:30:00Z",
        periodStart: "2025-12-01",
        periodEnd: "2025-12-31",
      });
      // 1 December 2025, 00:30 Almaty = 30 November 19:30 UTC.
      await addPayment(tx, {
        clientId: a,
        amount: 22000,
        at: "2025-11-30T19:30:00Z",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      });
      // 1 November 2025, 00:10 Almaty = 31 October 19:10 UTC.
      await addPayment(tx, {
        clientId: a,
        amount: 33000,
        at: "2025-10-31T19:10:00Z",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
      });

      const november = await reportAsOwner(tx, "2025-11-01", "2025-12-05");
      const december = await reportAsOwner(tx, "2025-12-01", "2025-12-05");
      // Other fixtures are rolled back; seeds start later, so these months hold only these rows.
      expect(november.total).toEqual({ amount: 44000, count: 2 });
      expect(december.total).toEqual({ amount: 22000, count: 1 });
    });
  });

  it("criterion 1: on the seeds, the current month matches a hand count straight from payments", async () => {
    await rolledBack(sql, async (tx) => {
      const [{ month } = { month: "" }] = await tx<{ month: string }[]>`
        select to_char(date_trunc('month', now() at time zone 'Asia/Almaty'), 'YYYY-MM-DD') as month
      `;
      const [hand] = await tx<
        { amount: number; count: number; reversed: number }[]
      >`
        select
          coalesce(sum(p.amount) filter (where r.id is null), 0)::integer as amount,
          (count(*) filter (where r.id is null))::integer as count,
          coalesce(sum(p.amount) filter (where r.id is not null), 0)::integer as reversed
        from public.payments p
        left join public.payments r on r.reverses_id = p.id
        where p.kind = 'payment'
          and to_char(p.created_at at time zone 'Asia/Almaty', 'YYYY-MM') = left(${month}, 7)
      `;
      const report = await reportAsOwner(tx, month, month);
      expect(hand?.count).toBeGreaterThan(0);
      expect(report.total).toEqual({
        amount: hand?.amount,
        count: hand?.count,
      });
      expect(report.reversed.amount).toBe(hand?.reversed);
      const sum = (rows: MoneyCount[]) =>
        rows.reduce((s, r) => s + r.amount, 0);
      expect(sum(report.by_method)).toBe(hand?.amount);
      expect(sum(report.by_group)).toBe(hand?.amount);
    });
  });

  it("refuses a date that is not the first day of a month", async () => {
    await asActor(sql, owner, async (tx) => {
      await expect(
        tx`select public.report_month('2025-01-15'::date, '2025-01-20'::date)`,
      ).rejects.toMatchObject({ code: "22023" });
    });
  });
});

describe("report_month: debtors", () => {
  it("lists expired current clients by active group with the expected amount at the group price", async () => {
    await rolledBack(sql, async (tx) => {
      await onlyFixtureClients(tx);
      const [price] = await tx<{ default_price: number }[]>`
        select default_price from public.groups where id = ${SEED_GROUP}
      `;
      const late = await addClient(tx, { lastName: "Бдолжник" });
      const later = await addClient(tx, { lastName: "Адолжник" });
      const paid = await addClient(tx, { lastName: "Воплатил" });
      const archived = await addClient(tx, {
        lastName: "Гархив",
        archived: true,
      });
      const noGroup = await addClient(tx, {
        lastName: "Дбезгруппы",
        groupId: null,
      });
      const never = await addClient(tx, { lastName: "Енетоплат" });
      for (const id of [late, later, archived, noGroup]) {
        await addPayment(tx, {
          clientId: id,
          amount: 15000,
          at: "2024-12-01T05:00:00Z",
          periodStart: "2024-12-01",
          periodEnd: "2024-12-31",
        });
      }
      await addPayment(tx, {
        clientId: paid,
        amount: 15000,
        at: "2025-01-05T05:00:00Z",
        periodStart: "2025-01-05",
        periodEnd: "2025-02-04",
      });

      const report = await reportAsOwner(tx, MONTH, "2025-01-20");
      expect(report.debtors).toHaveLength(2);
      const [group, none] = report.debtors;
      expect(group?.group_id).toBe(SEED_GROUP);
      expect(group?.count).toBe(2);
      expect(group?.price).toBe(price?.default_price);
      expect(group?.expected).toBe((price?.default_price ?? 0) * 2);
      expect(group?.clients.map((c) => c.last_name)).toEqual([
        "Адолжник",
        "Бдолжник",
      ]);
      expect(group?.clients[0]?.ends_on).toBe("2024-12-31");
      expect(none).toMatchObject({
        group_id: null,
        price: null,
        expected: null,
        count: 1,
      });
      const ids = report.debtors.flatMap((g) => g.clients.map((c) => c.id));
      expect(ids).not.toContain(paid);
      expect(ids).not.toContain(archived);
      expect(ids).not.toContain(never);
    });
  });
});

describe("report and export functions: owner only", () => {
  it("criterion 2: an admin calling report_month directly is refused by the database", async () => {
    await asActor(sql, admin, async (tx) => {
      await expect(
        tx`select public.report_month(${MONTH}::date, '2025-01-20'::date)`,
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it.each([
    [
      "export_payments",
      (tx: Tx) => tx`select public.export_payments(${MONTH}::date, 'xlsx')`,
    ],
    [
      "export_clients",
      (tx: Tx) => tx`select public.export_clients('csv', '2025-01-20'::date)`,
    ],
    [
      "begin_export",
      (tx: Tx) => tx`select public.begin_export('client', 'csv', '{}'::jsonb)`,
    ],
  ])(
    "criterion 3: an admin calling %s is refused and nothing is logged",
    async (_, call) => {
      await rolledBack(sql, async (tx) => {
        await become(tx, admin);
        await tx`savepoint attempt`;
        await expect(call(tx)).rejects.toMatchObject({ code: "42501" });
        await tx`rollback to savepoint attempt`;
        await become(tx, "postgres");
        const [row] = await tx<{ count: number }[]>`
        select count(*)::integer as count from public.audit_log
        where actor_id = ${SEED_STAFF.admin} and action = 'report.export'
      `;
        expect(row?.count).toBe(0);
      });
    },
  );

  it.each(["anon", "service_role"] as const)(
    "%s cannot read a report",
    async (role) => {
      await asActor(sql, role, async (tx) => {
        await expect(
          tx`select public.report_month(${MONTH}::date, '2025-01-20'::date)`,
        ).rejects.toMatchObject({ code: "42501" });
      });
    },
  );
});

describe("exports", () => {
  it("export_payments lists payments and reversals of the month, no opening balances, and logs it without personal data", async () => {
    await rolledBack(sql, async (tx) => {
      const a = await addClient(tx, { lastName: "Выгрузкин" });
      const p = await addPayment(tx, {
        clientId: a,
        amount: 15000,
        method: "kaspi",
        at: "2025-01-05T05:00:00Z",
      });
      await reverse(tx, p, "2025-01-05T06:00:00Z");
      await addOpeningBalance(tx, a, "2025-01-06T05:00:00Z");
      await addPayment(tx, {
        clientId: a,
        amount: 15000,
        at: "2025-02-05T05:00:00Z",
      });

      await become(tx, owner);
      const [row] = await tx<
        {
          rows: {
            kind: string;
            amount: number;
            reversed: boolean;
            last_name: string;
            method: string;
          }[];
        }[]
      >`
        select public.export_payments(${MONTH}::date, 'xlsx') as rows
      `;
      expect(
        row?.rows.map((r) => [r.kind, r.amount, r.reversed, r.method]),
      ).toEqual([
        ["payment", 15000, true, "kaspi"],
        ["reversal", -15000, false, "kaspi"],
      ]);
      expect(row?.rows[0]?.last_name).toBe("Выгрузкин");

      await become(tx, "postgres");
      const audit = await tx<
        { entity: string; details: Record<string, unknown> }[]
      >`
        select entity, details from public.audit_log
        where actor_id = ${SEED_STAFF.owner} and action = 'report.export'
        order by created_at desc limit 1
      `;
      expect(audit[0]).toEqual({
        entity: "payment",
        details: { month: "2025-01", rows: 2, format: "xlsx" },
      });
      expect(JSON.stringify(audit)).not.toContain("Выгрузкин");
    });
  });

  it("export_clients lists current and archived clients with status, never deleted ones", async () => {
    await rolledBack(sql, async (tx) => {
      const archived = await addClient(tx, {
        lastName: "Архивный",
        archived: true,
      });
      await addPayment(tx, {
        clientId: archived,
        amount: 15000,
        at: "2024-12-01T05:00:00Z",
        periodStart: "2024-12-01",
        periodEnd: "2024-12-31",
      });
      const deleted = await addClient(tx, { lastName: "Удалённый" });
      await tx`
        update public.clients set archived_at = now(), deleted_at = now() where id = ${deleted}
      `;
      const [{ count: total } = { count: 0 }] = await tx<{ count: number }[]>`
        select count(*)::integer as count from public.clients where deleted_at is null
      `;

      await become(tx, owner);
      const [row] = await tx<
        {
          rows: {
            last_name: string;
            archived: boolean;
            status: string;
            ends_on: string | null;
          }[];
        }[]
      >`
        select public.export_clients('csv', '2025-01-20'::date) as rows
      `;
      expect(row?.rows).toHaveLength(total);
      expect(row?.rows.find((r) => r.last_name === "Архивный")).toMatchObject({
        archived: true,
        status: "expired",
        ends_on: "2024-12-31",
      });
      expect(row?.rows.some((r) => r.last_name === "Удалённый")).toBe(false);
    });
  });

  it("refuses an unknown format", async () => {
    await asActor(sql, owner, async (tx) => {
      await expect(
        tx`select public.export_clients('pdf', '2025-01-20'::date)`,
      ).rejects.toMatchObject({ code: "22023" });
    });
  });

  it("stops at 20 exports an hour per employee", async () => {
    await rolledBack(sql, async (tx) => {
      // now() is the transaction start, so these count as made within the hour.
      await tx`
        insert into public.audit_log (actor_id, action, entity, details)
        select ${SEED_STAFF.owner}, 'report.export', 'client', '{"format":"csv","rows":0}'::jsonb
        from generate_series(1, 19)
      `;
      await become(tx, owner);
      await tx`select public.export_clients('csv', '2025-01-20'::date)`;
      await expect(
        tx`select public.export_clients('csv', '2025-01-20'::date)`,
      ).rejects.toMatchObject({ code: "P0001", message: "rate_limited" });
    });
  });

  it("an export older than an hour does not count", async () => {
    await rolledBack(sql, async (tx) => {
      await tx`
        insert into public.audit_log (actor_id, action, entity, details, created_at)
        select ${SEED_STAFF.owner}, 'report.export', 'client', '{}'::jsonb,
               now() - interval '61 minutes'
        from generate_series(1, 25)
      `;
      await become(tx, owner);
      await expect(
        tx`select public.export_clients('csv', '2025-01-20'::date)`,
      ).resolves.toBeDefined();
    });
  });
});
