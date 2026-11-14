import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { readXlsx } from "@/features/import/xlsx";
import { currentMonth } from "@/features/reports/month";
import { exportData, getMonthReport } from "@/features/reports/service";
import { reportsText } from "@/i18n/reports";

import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
  type TempStaff,
} from "../support/staff-accounts";
import { SEED_STAFF } from "./support/roles";

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const NOW = new Date();

async function signIn(email: string, password: string): Promise<Db> {
  const db: Db = createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return db;
}

/** A fresh owner: exports are committed and counted per employee (20 an hour). */
async function freshOwner(): Promise<{ staff: TempStaff; db: Db }> {
  const staff = await createTempStaff(connection, "owner");
  return { staff, db: await signIn(staff.email, staff.password) };
}

async function exportCount(staffId: string): Promise<number> {
  const { count, error } = await service
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", staffId)
    .eq("action", "report.export");
  if (error) throw new Error(`audit count failed: ${error.code}`);
  return count ?? 0;
}

let owner: { staff: TempStaff; db: Db };
let adminDb: Db;

beforeAll(async () => {
  owner = await freshOwner();
  adminDb = await signIn(SEED_EMAILS.admin, SEED_PASSWORD);
});

const month = currentMonth(NOW);

describe("getMonthReport", () => {
  it("returns the month's money and debtors for the owner, consistent with itself", async () => {
    const report = await getMonthReport(owner.db, NOW, month);
    expect(report.byMethod.map((m) => m.method)).toEqual([
      "cash",
      "kaspi",
      "transfer",
    ]);
    const sum = (rows: { amount: number }[]) =>
      rows.reduce((total, row) => total + row.amount, 0);
    expect(sum(report.byMethod)).toBe(report.total.amount);
    expect(sum(report.byGroup)).toBe(report.total.amount);
    for (const group of report.debtors) {
      expect(group.clients).toHaveLength(group.count);
      expect(group.expected).toBe((group.price ?? 0) * group.count);
    }
  });

  it("criterion 2: an admin is refused by the database", async () => {
    await expect(getMonthReport(adminDb, NOW, month)).rejects.toThrow(
      "report_month failed: 42501",
    );
  });
});

describe("exportData", () => {
  it("criterion 3: an admin gets forbidden (the route answers 403) and nothing is logged", async () => {
    const before = await exportCount(SEED_STAFF.admin);
    const payments = await exportData(adminDb, NOW, {
      data: "payments",
      format: "xlsx",
      month,
    });
    const clients = await exportData(adminDb, NOW, {
      data: "clients",
      format: "csv",
    });
    expect(payments).toEqual({ ok: false, error: "forbidden" });
    expect(clients).toEqual({ ok: false, error: "forbidden" });
    expect(await exportCount(SEED_STAFF.admin)).toBe(before);
  });

  it("gives the owner an .xlsx of the month's payments with the header and logs it", async () => {
    const result = await exportData(owner.db, NOW, {
      data: "payments",
      format: "xlsx",
      month,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.fileName).toBe(`payments-${month}.xlsx`);
    const rows = readXlsx(result.data.body);
    expect(rows[0]).toEqual([...reportsText.file.paymentsHeader]);
    expect(rows.length).toBeGreaterThan(1);
    expect(await exportCount(owner.staff.id)).toBe(1);
  });

  it("gives the owner a CSV of all clients named by date only", async () => {
    const result = await exportData(owner.db, NOW, {
      data: "clients",
      format: "csv",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.fileName).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = new TextDecoder().decode(result.data.body);
    expect(text.split("\r\n")[0]).toBe(
      reportsText.file.clientsHeader.join(";"),
    );
  });

  it("parallel requests at the limit: exactly one more export passes", async () => {
    const { staff, db } = await freshOwner();
    const { error } = await service.from("audit_log").insert(
      Array.from({ length: 19 }, () => ({
        actor_id: staff.id,
        action: "report.export",
        entity: "client",
        details: { format: "csv", rows: 0 },
      })),
    );
    if (error) throw new Error(`audit insert failed: ${error.code}`);

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        exportData(db, NOW, { data: "clients", format: "csv" }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "rate_limited" },
      { ok: false, error: "rate_limited" },
    ]);
    expect(await exportCount(staff.id)).toBe(20);
  });
});
