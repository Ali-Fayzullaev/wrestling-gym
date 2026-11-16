import { z } from "zod";

import type { Db } from "@/db/client";
import type { Messages } from "@/i18n/messages";
import { businessDate } from "@/lib/dates";

import {
  buildExportFile,
  clientRowShape,
  clientsTable,
  paymentRowShape,
  paymentsTable,
} from "./export-table";
import { monthStart } from "./month";
import type {
  ExportError,
  ExportFile,
  ExportResult,
  MonthReport,
} from "./result";
import type { ExportQuery } from "./schema";

// Shape of report_month() (supabase/migrations/*_reports.sql). Every sum and count is computed in
// Postgres; this file only checks the reply and renames fields.
const moneyCount = { amount: z.number().int(), count: z.number().int() };

const reportShape = z.object({
  total: z.object(moneyCount),
  reversed: z.object(moneyCount),
  by_method: z.array(
    z.object({ method: z.enum(["cash", "kaspi", "transfer"]), ...moneyCount }),
  ),
  by_group: z.array(
    z.object({
      group_id: z.string().nullable(),
      name: z.string().nullable(),
      ...moneyCount,
    }),
  ),
  debtors: z.array(
    z.object({
      group_id: z.string().nullable(),
      name: z.string().nullable(),
      price: z.number().int().nullable(),
      count: z.number().int(),
      expected: z.number().int().nullable(),
      clients: z.array(
        z.object({
          id: z.string(),
          last_name: z.string(),
          first_name: z.string(),
          ends_on: z.string().nullable(),
        }),
      ),
    }),
  ),
});

/** The reports screen for `month` ("YYYY-MM"); debtors as of `now` in Asia/Almaty. */
export async function getMonthReport(
  db: Db,
  now: Date,
  month: string,
): Promise<MonthReport> {
  const { data, error } = await db.rpc("report_month", {
    p_month: monthStart(month),
    p_today: businessDate(now),
  });
  if (error) throw new Error(`report_month failed: ${error.code}`);
  const report = reportShape.parse(data);
  return {
    total: report.total,
    reversed: report.reversed,
    byMethod: report.by_method,
    byGroup: report.by_group.map(({ group_id, ...rest }) => ({
      groupId: group_id,
      ...rest,
    })),
    debtors: report.debtors.map((group) => ({
      groupId: group.group_id,
      name: group.name,
      price: group.price,
      count: group.count,
      expected: group.expected ?? 0,
      clients: group.clients.map((client) => ({
        id: client.id,
        name: `${client.last_name} ${client.first_name}`,
        endsOn: client.ends_on,
      })),
    })),
  };
}

/** Postgres errors of the export functions, mapped to what the response can say. */
function exportError(error: { code?: string; message?: string }): ExportError {
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0001" && error.message === "rate_limited")
    return "rate_limited";
  if (error.code === "22023") return "invalid";
  return "unavailable";
}

/**
 * Payments of a month or all clients as an .xlsx or .csv file. The database checks the role and
 * the hourly limit and writes the audit row in the same call that reads the rows. Headers are in
 * the language of the employee who downloads (`texts`).
 */
export async function exportData(
  db: Db,
  now: Date,
  query: ExportQuery,
  texts: Messages["reports"],
): Promise<ExportResult<ExportFile>> {
  if (query.data === "payments") {
    if (!query.month) return { ok: false, error: "invalid" };
    const { data, error } = await db.rpc("export_payments", {
      p_month: monthStart(query.month),
      p_format: query.format,
    });
    if (error) return { ok: false, error: exportError(error) };
    const rows = z.array(paymentRowShape).parse(data);
    return {
      ok: true,
      data: buildExportFile(
        paymentsTable(rows, texts),
        query.format,
        `payments-${query.month}`,
        texts.file.paymentsSheet,
      ),
    };
  }

  const today = businessDate(now);
  const { data, error } = await db.rpc("export_clients", {
    p_format: query.format,
    p_today: today,
  });
  if (error) return { ok: false, error: exportError(error) };
  const rows = z.array(clientRowShape).parse(data);
  return {
    ok: true,
    data: buildExportFile(
      clientsTable(rows, texts),
      query.format,
      `clients-${today}`,
      texts.file.clientsSheet,
    ),
  };
}
