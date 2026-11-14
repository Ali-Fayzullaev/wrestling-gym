import { afterAll, describe, expect, it } from "vitest";

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

type Counts = {
  remind_today: number;
  debtors: number;
  expiring_week: number;
  paid_today: number;
};

type Row = {
  id: string;
  last_name: string;
  first_name: string;
  group_name: string | null;
  price: number | null;
  ends_on: string | null;
};

type Screen = { counts: Counts; remind: Row[]; paid: Row[] };

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Hides seed clients so the screen only sees this test's fixtures. */
async function onlyFixtures(tx: Tx) {
  await tx`update public.clients set archived_at = now() where archived_at is null`;
}

/** A client whose single payment (recorded long ago) ends `daysLeft` days after TODAY. */
async function clientEndingIn(tx: Tx, daysLeft: number, lastName: string) {
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

/** A client whose payment was recorded at `instant` (UTC) and starts on TODAY. */
async function clientPaidAt(tx: Tx, instant: string, lastName: string) {
  const clientId = await insertClient(tx, { lastName });
  const paymentId = await insertPayment(tx, {
    clientId,
    periodStart: TODAY,
    periodEnd: addDays(TODAY, 29),
    createdAt: new Date(instant),
  });
  return { clientId, paymentId };
}

async function screenOn(tx: Tx, today = TODAY): Promise<Screen> {
  const [row] = await tx<{ s: Screen }[]>`
    select public.today_screen(${today}::date) as s
  `;
  if (!row) throw new Error("today_screen returned nothing");
  return row.s;
}

async function countsOn(tx: Tx, today = TODAY): Promise<Counts> {
  const [row] = await tx<Counts[]>`
    select * from public.dashboard_counts(${today}::date)
  `;
  if (!row) throw new Error("dashboard_counts returned nothing");
  return row;
}

const names = (rows: Row[]) => rows.map((row) => row.last_name);

describe("criterion 1: today_screen on a fixed date (boundaries)", () => {
  async function boundaryFixtures(tx: Tx) {
    await onlyFixtures(tx);
    await clientEndingIn(tx, 0, "Сегодня"); // ends today: overdue reminder, expiring
    await clientEndingIn(tx, -1, "Вчера"); // ended yesterday: debtor, no reminder
    await clientEndingIn(tx, 1, "Завтра"); // before_1 reminder, expiring
    await clientEndingIn(tx, 7, "Неделя"); // before_7 reminder, expiring
    await clientEndingIn(tx, 8, "Восемь"); // active, nothing due
    // 00:30 on 15 March in Almaty is today; 23:30 on 14 March is not.
    await clientPaidAt(tx, "2026-03-14T19:30:00Z", "Полночь");
    await clientPaidAt(tx, "2026-03-14T18:30:00Z", "Вечер");
    await become(tx, admin);
    return { screen: await screenOn(tx), counts: await countsOn(tx) };
  }

  it("counts the boundary cases as the spec says", async () => {
    const { screen, counts } = await rolledBack(sql, boundaryFixtures);
    expect(counts).toEqual({
      remind_today: 3,
      debtors: 1,
      expiring_week: 3,
      paid_today: 1,
    });
    // The screen shows dashboard_counts() itself, not its own count.
    expect(screen.counts).toEqual(counts);
  });

  it("lists who to remind, soonest end first, and who paid today", async () => {
    const { screen } = await rolledBack(sql, boundaryFixtures);
    expect(names(screen.remind)).toEqual(["Сегодня", "Завтра", "Неделя"]);
    expect(screen.remind.map((row) => row.ends_on)).toEqual([
      TODAY,
      addDays(TODAY, 1),
      addDays(TODAY, 7),
    ]);
    expect(names(screen.paid)).toEqual(["Полночь"]);
  });

  it("each list has exactly as many rows as its counter on the seed data", async () => {
    // The seed is relative to the real today, so this runs on the server's own date.
    const live = await asActor(sql, owner, async (tx) => {
      const [row] = await tx<
        { s: Screen }[]
      >`select public.today_screen() as s`;
      if (!row) throw new Error("today_screen returned nothing");
      return row.s;
    });
    expect(live.remind).toHaveLength(live.counts.remind_today);
    expect(live.paid).toHaveLength(live.counts.paid_today);
    expect(live.counts.remind_today).toBeGreaterThan(0);
    expect(live.counts.paid_today).toBeGreaterThan(0);
  });

  it("gives the active group's name and price for the payment form", async () => {
    const row = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      await clientEndingIn(tx, 1, "Сгруппой");
      await become(tx, admin);
      return (await screenOn(tx)).remind[0];
    });
    expect(row).toMatchObject({
      last_name: "Сгруппой",
      first_name: "Клиент",
      group_name: "Дети 6–9 лет, утро",
      price: 15000,
    });
  });

  it("an archived group gives no name and no price", async () => {
    const row = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const { clientId } = await clientEndingIn(tx, 1, "Архивгруппа");
      await tx`
        update public.groups set archived_at = now()
        where id = (select group_id from public.clients where id = ${clientId})
      `;
      await become(tx, admin);
      return (await screenOn(tx)).remind[0];
    });
    expect(row).toMatchObject({ group_name: null, price: null });
  });
});

describe("criterion 2: a reversed payment is not 'paid today'", () => {
  it("a payment made today and reversed leaves the client out", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const kept = await clientPaidAt(tx, "2026-03-15T04:00:00Z", "Оплатил");
      const reversed = await clientPaidAt(tx, "2026-03-15T05:00:00Z", "Сторно");
      await insertReversal(tx, {
        clientId: reversed.clientId,
        reversesId: reversed.paymentId,
        periodStart: TODAY,
        periodEnd: addDays(TODAY, 29),
      });
      expect(kept.clientId).not.toBe(reversed.clientId);
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(screen.counts.paid_today).toBe(1);
    expect(names(screen.paid)).toEqual(["Оплатил"]);
  });

  it("two payments today by one client count once", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const { clientId } = await clientPaidAt(
        tx,
        "2026-03-15T04:00:00Z",
        "Дважды",
      );
      await insertPayment(tx, {
        clientId,
        periodStart: addDays(TODAY, 30),
        periodEnd: addDays(TODAY, 59),
        createdAt: new Date("2026-03-15T06:00:00Z"),
      });
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(screen.counts.paid_today).toBe(1);
    expect(screen.paid).toHaveLength(1);
  });
});

describe("reminders already opened and archived clients", () => {
  it("a reminder opened for the current subscription leaves the list", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const opened = await clientEndingIn(tx, 1, "Открыт");
      await clientEndingIn(tx, 1, "Неоткрыт");
      await tx`
        insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
        values (
          ${opened.clientId}, ${opened.paymentId}, 'before_1', ${await templateId(tx, "before_1")},
          ${SEED_STAFF.admin}
        )
      `;
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(names(screen.remind)).toEqual(["Неоткрыт"]);
    expect(screen.counts.remind_today).toBe(1);
  });

  it("a reminder of another kind does not hide today's one", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const client = await clientEndingIn(tx, 1, "Раньше");
      await tx`
        insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
        values (
          ${client.clientId}, ${client.paymentId}, 'before_7', ${await templateId(tx, "before_7")},
          ${SEED_STAFF.admin}
        )
      `;
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(names(screen.remind)).toEqual(["Раньше"]);
  });

  it("archived clients appear in neither list nor counter", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      const due = await clientEndingIn(tx, 0, "Архив");
      const paid = await clientPaidAt(tx, "2026-03-15T04:00:00Z", "Архив2");
      await tx`
        update public.clients set archived_at = now()
        where id in (${due.clientId}, ${paid.clientId})
      `;
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(screen).toEqual({
      counts: { remind_today: 0, debtors: 0, expiring_week: 0, paid_today: 0 },
      remind: [],
      paid: [],
    });
  });

  it("follows the reminder days set by the owner", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await onlyFixtures(tx);
      await tx`update public.settings set reminder_days = '{3}'`;
      await clientEndingIn(tx, 3, "Три");
      await clientEndingIn(tx, 7, "Семь");
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(names(screen.remind)).toEqual(["Три"]);
    expect(screen.counts.remind_today).toBe(1);
  });
});

describe("access: another role is refused", () => {
  it.each(["today_screen", "reminders_due", "paid_today"])(
    "anon cannot call %s",
    async (fn) => {
      await expect(
        asActor(sql, "anon", (tx) =>
          tx.unsafe(`select public.${fn}('2026-03-15')`),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("a deactivated employee gets empty lists and zero counters", async () => {
    const screen = await rolledBack(sql, async (tx) => {
      await tx`update public.staff set active = false where id = ${SEED_STAFF.admin}`;
      await become(tx, admin);
      return screenOn(tx);
    });
    expect(screen).toEqual({
      counts: { remind_today: 0, debtors: 0, expiring_week: 0, paid_today: 0 },
      remind: [],
      paid: [],
    });
  });

  it("owner and admin see the same screen (head counts, no money totals)", async () => {
    const forOwner = await asActor(sql, owner, (tx) => screenOn(tx));
    const forAdmin = await asActor(sql, admin, (tx) => screenOn(tx));
    expect(forAdmin).toEqual(forOwner);
  });
});
