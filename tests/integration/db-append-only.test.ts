import { afterAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "./db";
import { insertClient, insertPayment, templateId } from "./support/fixtures";
import {
  admin,
  asActor,
  become,
  owner,
  rolledBack,
  SEED_STAFF,
  type Actor,
  type Tx,
} from "./support/roles";

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const APPEND_ONLY = ["payments", "consents", "audit_log"] as const;

// Owner and admin lack the UPDATE/DELETE grant; service_role and the table owner have it, so for
// them the trigger is what stops the statement.
const REFUSALS: [string, Actor, { code: string; message?: RegExp }][] = [
  ["owner", owner, { code: "42501" }],
  ["admin", admin, { code: "42501" }],
  ["service_role", "service_role", { code: "P0001", message: /append-only/ }],
  [
    "postgres (table owner)",
    "postgres",
    { code: "P0001", message: /append-only/ },
  ],
];

describe("criterion 3: payments, consents and audit_log reject update and delete", () => {
  describe.each(APPEND_ONLY)("%s", (table) => {
    it.each(REFUSALS)("update by %s fails", async (_name, actor, expected) => {
      await expect(
        asActor(sql, actor, (tx) =>
          tx.unsafe(`update public.${table} set created_at = created_at`),
        ),
      ).rejects.toMatchObject(expected);
    });

    it.each(REFUSALS)("delete by %s fails", async (_name, actor, expected) => {
      await expect(
        asActor(sql, actor, (tx) => tx.unsafe(`delete from public.${table}`)),
      ).rejects.toMatchObject(expected);
    });

    it.each(REFUSALS)("truncate by %s fails", async (_name, actor) => {
      await expect(
        asActor(sql, actor, (tx) =>
          tx.unsafe(`truncate public.${table} cascade`),
        ),
      ).rejects.toThrow();
    });

    it("rows are still there", async () => {
      const [row] = await rolledBack(sql, (tx) =>
        tx.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public.${table}`,
        ),
      );
      expect(row?.n).toBeGreaterThan(0);
    });
  });

  it("a payment of a new client cannot be edited by the service role either", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const paymentId = await insertPayment(tx, {
          clientId,
          periodStart: "2026-01-10",
          periodEnd: "2026-02-09",
        });
        await become(tx, "service_role");
        await tx`update public.payments set amount = 1 where id = ${paymentId}`;
      }),
    ).rejects.toMatchObject({
      code: "P0001",
      message: expect.stringMatching(/append-only/),
    });
  });
});

describe("reminder_events only move from chat_opened to marked_sent", () => {
  async function openedEvent(tx: Tx): Promise<string> {
    const clientId = await insertClient(tx);
    const paymentId = await insertPayment(tx, {
      clientId,
      periodStart: "2026-01-10",
      periodEnd: "2026-02-09",
    });
    const [row] = await tx<{ id: string }[]>`
      insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
      values (${clientId}, ${paymentId}, 'before_1', ${await templateId(tx, "before_1")}, ${SEED_STAFF.owner})
      returning id
    `;
    if (!row) throw new Error("event not inserted");
    return row.id;
  }

  const markSent = (tx: Tx, id: string) => tx`
    update public.reminder_events
    set status = 'marked_sent', marked_sent_by = ${SEED_STAFF.owner}, marked_sent_at = now()
    where id = ${id}
  `;

  it("chat_opened -> marked_sent is allowed", async () => {
    const status = await rolledBack(sql, async (tx) => {
      const id = await openedEvent(tx);
      await markSent(tx, id);
      const [row] = await tx<{ status: string }[]>`
        select status from public.reminder_events where id = ${id}
      `;
      return row?.status;
    });
    expect(status).toBe("marked_sent");
  });

  it("marked_sent cannot go back to chat_opened", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const id = await openedEvent(tx);
        await markSent(tx, id);
        await tx`
          update public.reminder_events
          set status = 'chat_opened', marked_sent_by = null, marked_sent_at = null
          where id = ${id}
        `;
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("other columns cannot change, even together with the transition", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const id = await openedEvent(tx);
        await tx`
          update public.reminder_events
          set status = 'marked_sent', marked_sent_by = ${SEED_STAFF.owner}, marked_sent_at = now(),
              opened_at = now() - interval '1 day'
          where id = ${id}
        `;
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("marked_sent requires who and when", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const id = await openedEvent(tx);
        await tx`update public.reminder_events set status = 'marked_sent' where id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["owner", owner, "42501"],
    ["service_role", "service_role", "P0001"],
  ] as const)("delete by %s fails", async (_name, actor, code) => {
    await expect(
      rolledBack(sql, async (tx) => {
        await openedEvent(tx);
        await become(tx, actor);
        await tx`delete from public.reminder_events`;
      }),
    ).rejects.toMatchObject({ code });
  });

  it("a reminder cannot point at a reversal", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const [reversal] = await tx<{ id: string; client_id: string }[]>`
          select id, client_id from public.payments where kind = 'reversal' limit 1
        `;
        await tx`
          insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
          values (${reversal?.client_id ?? null}, ${reversal?.id ?? null}, 'overdue',
                  ${await templateId(tx, "overdue")}, ${SEED_STAFF.owner})
        `;
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("a reminder must belong to the payment's client", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const clientId = await insertClient(tx);
        const otherClient = await insertClient(tx);
        const paymentId = await insertPayment(tx, {
          clientId,
          periodStart: "2026-01-10",
          periodEnd: "2026-02-09",
        });
        await tx`
          insert into public.reminder_events (client_id, payment_id, kind, template_id, opened_by)
          values (${otherClient}, ${paymentId}, 'overdue', ${await templateId(tx, "overdue")},
                  ${SEED_STAFF.owner})
        `;
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
