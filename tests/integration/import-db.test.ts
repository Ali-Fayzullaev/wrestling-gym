import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { matchHeaders } from "@/features/import/columns";
import { readTable } from "@/features/import/file";
import { groupKey } from "@/features/import/group-key";
import { buildPreview } from "@/features/import/rows";
import { fileHash, planImport } from "@/features/import/service";

import { csvText, utf8 } from "../support/sheets";
import { connectLocalDb } from "./db";
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

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-11-14";
const HEADERS = ["Фамилия", "Имя", "Телефон", "Группа", "Дата окончания"];

/** Fictional phones outside the seed range and outside testPhone() (+7700000 9xxx). */
function phone(n: number, prefix = "702"): string {
  return `+7${prefix}${String(n).padStart(7, "0")}`;
}

/** A notebook file of `count` clients, run through the real parser as the service does. */
function notebook(
  count: number,
  endsOn: (i: number) => string = () => "18.12.2026",
) {
  const rows = Array.from({ length: count }, (_, i) => [
    `Импортов${i}`,
    "Клиент",
    phone(i),
    "",
    endsOn(i),
  ]);
  const bytes = utf8(csvText([HEADERS, ...rows]));
  const read = readTable({ name: "notebook.csv", bytes });
  if (!read.ok) throw new Error(read.error);
  const preview = buildPreview(read.table, matchHeaders(read.table.headers), {
    existing: [],
    groups: [],
  });
  const plan = planImport(preview, {});
  if (!plan) throw new Error("plan");
  return { hash: fileHash(bytes), rows: plan.rows, newGroups: plan.newGroups };
}

type ImportReply = {
  created: number;
  duplicates: number;
  groups_created: number;
};

async function importClients(
  tx: Tx,
  file: { hash: string; rows: unknown[]; newGroups?: unknown[] },
): Promise<ImportReply> {
  const [row] = await tx<{ result: ImportReply }[]>`
    select public.import_clients(
      ${file.hash}, ${tx.json(file.rows as never)}, ${tx.json((file.newGroups ?? []) as never)},
      ${TODAY}::date
    ) as result
  `;
  if (!row) throw new Error("no reply");
  return row.result;
}

async function countClients(tx: Tx): Promise<number> {
  const [row] = await tx<
    { n: number }[]
  >`select count(*)::int as n from public.clients`;
  return row?.n ?? 0;
}

describe("import_clients", () => {
  it("imports 150 rows into 150 clients; the same file again creates none", async () => {
    await asActor(sql, owner, async (tx) => {
      const file = notebook(150);
      const before = await countClients(tx);
      expect(await importClients(tx, file)).toEqual({
        created: 150,
        duplicates: 0,
        groups_created: 0,
      });
      expect(await countClients(tx)).toBe(before + 150);

      expect(await importClients(tx, file)).toEqual({
        created: 0,
        duplicates: 150,
        groups_created: 0,
      });
      expect(await countClients(tx)).toBe(before + 150);

      const audit = await tx<{ details: Record<string, unknown> }[]>`
        select details from public.audit_log
        where action = 'client.import' and details ->> 'file_hash' = ${file.hash}
        order by created_at
      `;
      expect(audit).toHaveLength(2);
      // Counts and the hash only: no names or phones in the audit log.
      expect(Object.keys(audit[0]?.details ?? {}).sort()).toEqual(
        ["created", "duplicates", "file_hash", "groups_created", "rows"].sort(),
      );
      expect(JSON.stringify(audit)).not.toContain("Импортов");
      expect(JSON.stringify(audit)).not.toContain(phone(1));
    });
  });

  it("treats a client already on file as a duplicate, ignoring case and spaces", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, "postgres");
      await insertClient(tx, { lastName: "ИМПОРТОВ0", phone: phone(0) });
      await become(tx, owner);
      const result = await importClients(tx, notebook(3));
      expect(result).toMatchObject({ created: 2, duplicates: 1 });
    });
  });

  it("computes client_status from the end date in the file and records an honest balance", async () => {
    await asActor(sql, owner, async (tx) => {
      const ends = ["04.12.2026", "17.11.2026", "09.11.2026", ""];
      const file = notebook(4, (i) => ends[i] ?? "");
      await importClients(tx, file);
      const statuses = await tx<
        { phone: string; status: string; ends_on: string | null }[]
      >`
        select c.phone, s.status, s.ends_on::text
        from public.client_status(${TODAY}::date) s
        join public.clients c on c.id = s.client_id
        where c.phone = any (${file.rows.map((r) => r.phone)})
        order by c.phone
      `;
      expect(statuses).toEqual([
        { phone: phone(0), status: "active", ends_on: "2026-12-04" },
        { phone: phone(1), status: "expiring", ends_on: "2026-11-17" },
        { phone: phone(2), status: "expired", ends_on: "2026-11-09" },
        { phone: phone(3), status: "none", ends_on: null },
      ]);

      const payments = await tx`
        select p.kind, p.amount, p.method, p.reason, p.period_start::text, p.period_end::text
        from public.payments p join public.clients c on c.id = p.client_id
        where c.phone = ${phone(0)}
      `;
      expect(payments).toEqual([
        {
          kind: "import_balance",
          amount: 0,
          method: null,
          reason: "Перенос из тетради",
          period_start: "2026-11-05",
          period_end: "2026-12-04",
        },
      ]);
      const [client] = await tx`
        select phone_owner, started_on::text, group_id, created_by from public.clients
        where phone = ${phone(0)}
      `;
      expect(client).toEqual({
        phone_owner: "self",
        started_on: TODAY,
        group_id: null,
        created_by: SEED_STAFF.owner,
      });
    });
  });

  it("is all or nothing: one bad row stops the whole import", async () => {
    await asActor(sql, owner, async (tx) => {
      const before = await countClients(tx);
      const file = notebook(3);
      const rows = file.rows.map((row, i) =>
        i === 2 ? { ...row, phone: "12345" } : row,
      );
      await expect(
        tx.savepoint((sp) => importClients(sp, { ...file, rows })),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await countClients(tx)).toBe(before);
    });
  });

  it("puts rows into an existing group and creates new groups with coach and price", async () => {
    await asActor(sql, owner, async (tx) => {
      const file = notebook(3);
      const rows = [
        { ...file.rows[0], group_id: SEED_GROUP },
        { ...file.rows[1], new_group: "Новички утро" },
        { ...file.rows[2], new_group: "новички  утро" },
      ];
      const newGroups = [
        { name: "Новички утро", coach_id: SEED_STAFF.owner, price: 18000 },
      ];
      expect(
        await importClients(tx, { ...file, rows, newGroups }),
      ).toMatchObject({
        created: 3,
        groups_created: 1,
      });
      const placed = await tx<
        { phone: string; name: string; default_price: number }[]
      >`
        select c.phone, g.name, g.default_price
        from public.clients c join public.groups g on g.id = c.group_id
        where c.phone = any (${file.rows.map((r) => r.phone)})
        order by c.phone
      `;
      expect(placed.map((p) => p.name)).toEqual([
        "Дети 6–9 лет, утро",
        "Новички утро",
        "Новички утро",
      ]);
      expect(placed[1]?.default_price).toBe(18000);
      const [created] = await tx`
        select count(*)::int as n from public.audit_log where action = 'group.create'
          and created_at = now()
      `;
      expect(created?.n).toBe(1);
    });
  });

  it("refuses a new group without a known coach and a row naming an unknown group", async () => {
    await asActor(sql, owner, async (tx) => {
      const file = notebook(1);
      await expect(
        tx.savepoint((sp) =>
          importClients(sp, {
            ...file,
            rows: [{ ...file.rows[0], new_group: "Нет" }],
            newGroups: [{ name: "Нет", coach_id: randomUUID(), price: 1000 }],
          }),
        ),
      ).rejects.toMatchObject({ code: "P0002", message: "coach_not_found" });
      await expect(
        tx.savepoint((sp) =>
          importClients(sp, {
            ...file,
            rows: [{ ...file.rows[0], new_group: "Другая" }],
          }),
        ),
      ).rejects.toMatchObject({ code: "P0002", message: "group_not_found" });
      await expect(
        tx.savepoint((sp) =>
          importClients(sp, {
            ...file,
            rows: [{ ...file.rows[0], group_id: randomUUID() }],
          }),
        ),
      ).rejects.toMatchObject({ code: "P0002", message: "group_not_found" });
    });
  });

  it("refuses an admin, a stranger and an anonymous caller", async () => {
    const file = notebook(1);
    await asActor(sql, admin, async (tx) => {
      await expect(importClients(tx, file)).rejects.toMatchObject({
        code: "42501",
      });
    });
    await asActor(sql, admin, async (tx) => {
      await expect(
        tx`select public.import_context(${[phone(1)]}, ${file.hash})`,
      ).rejects.toMatchObject({ code: "42501" });
    });
    await asActor(sql, { userId: randomUUID() }, async (tx) => {
      await expect(importClients(tx, file)).rejects.toMatchObject({
        code: "42501",
      });
    });
    await asActor(sql, "anon", async (tx) => {
      await expect(importClients(tx, file)).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("refuses malformed input", async () => {
    await asActor(sql, owner, async (tx) => {
      const file = notebook(1);
      for (const bad of [
        { ...file, hash: "not-a-hash" },
        { ...file, rows: [] },
        {
          ...file,
          newGroups: Array.from({ length: 51 }, (_, i) => ({ name: `g${i}` })),
        },
      ])
        await expect(
          tx.savepoint((sp) => importClients(sp, bad)),
        ).rejects.toMatchObject({
          code: "22023",
        });
    });
  });

  it("allows ten imports an hour per employee, then refuses", async () => {
    await asActor(sql, owner, async (tx) => {
      for (let i = 0; i < 10; i += 1) await importClients(tx, notebook(1));
      await expect(importClients(tx, notebook(1))).rejects.toMatchObject({
        code: "P0001",
        message: "rate_limited",
      });
    });
  });

  it("imports 500 rows, parsing included, in under 5 seconds", async () => {
    await asActor(sql, owner, async (tx) => {
      const started = performance.now();
      const file = notebook(500);
      const result = await importClients(tx, file);
      const elapsed = performance.now() - started;
      expect(result.created).toBe(500);
      expect(elapsed).toBeLessThan(5000);
    });
  });
});

describe("import_group_key", () => {
  it("matches groupKey() in the app", async () => {
    for (const name of [
      "  Дети   7–9 ",
      "ЁЛКИ",
      "Взрослые\tвечер",
      "Group A",
    ]) {
      const [row] = await sql<
        { key: string }[]
      >`select public.import_group_key(${name}) as key`;
      expect(row?.key).toBe(groupKey(name));
    }
  });
});

describe("import_context", () => {
  it("returns clients with the given phones, active groups, active staff and an earlier import", async () => {
    await asActor(sql, owner, async (tx) => {
      const file = notebook(2);
      await importClients(tx, file);
      const [row] = await tx<{ ctx: Record<string, unknown> }[]>`
        select public.import_context(${[phone(1), phone(99)]}, ${file.hash}) as ctx
      `;
      expect(row?.ctx.existing).toEqual([
        { phone: phone(1), last_name: "Импортов1", first_name: "Клиент" },
      ]);
      expect(row?.ctx.imported_at).not.toBeNull();
      expect(row?.ctx.groups).toContainEqual({
        id: SEED_GROUP,
        name: "Дети 6–9 лет, утро",
      });
    });
  });
});

describe("opening balance (import_balance)", () => {
  async function importedOne(tx: Tx, ends = "04.12.2026") {
    const file = notebook(1, () => ends);
    await importClients(tx, file);
    const [row] = await tx<{ client_id: string; payment_id: string }[]>`
      select p.client_id, p.id as payment_id from public.payments p
      join public.clients c on c.id = p.client_id where c.phone = ${phone(0)}
    `;
    if (!row) throw new Error("not imported");
    return row;
  }

  it("cannot be reversed", async () => {
    await asActor(sql, owner, async (tx) => {
      const { payment_id } = await importedOne(tx);
      await expect(
        tx`select public.reverse_payment(${payment_id}, ${"ошибка"}, ${randomUUID()})`,
      ).rejects.toMatchObject({ code: "P0002", message: "payment_not_found" });
    });
  });

  it("can be written directly by the owner only, never with money or a method", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, owner);
      const { client_id } = await importedOne(tx);
      const row = (createdBy: string, extra: Record<string, unknown> = {}) => ({
        client_id,
        kind: "import_balance",
        amount: 0,
        method: null,
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        reason: "Перенос из тетради",
        idempotency_key: randomUUID(),
        created_by: createdBy,
        ...extra,
      });
      await tx`insert into public.payments ${tx(row(SEED_STAFF.owner))}`;
      await expect(
        tx.savepoint(
          (sp) =>
            sp`insert into public.payments ${sp(row(SEED_STAFF.owner, { amount: 100 }))}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        tx.savepoint(
          (sp) =>
            sp`insert into public.payments ${sp(row(SEED_STAFF.owner, { method: "cash" }))}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await become(tx, admin);
      await expect(
        tx.savepoint(
          (sp) => sp`insert into public.payments ${sp(row(SEED_STAFF.admin))}`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("is reminded about like a paid subscription", async () => {
    await rolledBack(sql, async (tx) => {
      await become(tx, owner);
      const { payment_id, client_id } = await importedOne(tx, "21.11.2026");
      const due = await tx`
        select kind from public.reminders_due(${TODAY}::date) where client_id = ${client_id}
      `;
      expect(due).toEqual([{ kind: "before_7" }]);
      await become(tx, admin);
      const [opened] = await tx<{ r: { created: boolean } }[]>`
        select public.record_reminder_opened(${payment_id}, 'before_7') as r
      `;
      expect(opened?.r.created).toBe(true);
    });
  });

  it("is extended from its end by the next payment while still valid (STUB(D-03))", async () => {
    await asActor(sql, owner, async (tx) => {
      const { client_id } = await importedOne(tx, "31.12.2099");
      const [paid] = await tx<{ r: { period_start: string } }[]>`
        select public.record_payment(${client_id}, 15000, 'cash', ${randomUUID()}) as r
      `;
      expect(paid?.r.period_start).toBe("2100-01-01");
    });
  });

  it("does not count as paid today", async () => {
    await asActor(sql, owner, async (tx) => {
      const { client_id } = await importedOne(tx);
      const paid = await tx`
        select 1 from public.paid_today((now() at time zone 'Asia/Almaty')::date)
        where client_id = ${client_id}
      `;
      expect(paid).toHaveLength(0);
    });
  });
});
