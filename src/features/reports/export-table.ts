import { z } from "zod";

import type { Messages } from "@/i18n/messages";
import { toCsv } from "@/lib/csv-write";
import { businessDateTime } from "@/lib/dates";
import { toXlsx, type XlsxCell } from "@/lib/xlsx-write";

import type { ExportFormat } from "./schema";
import type { ExportFile } from "./result";

// Rows of export_payments() / export_clients() (supabase/migrations/*_reports.sql) turned into a
// table and then into the file. The database returns jsonb, so rows are checked, not trusted.
// Headers and words are in the language of whoever downloads.

type ReportTexts = Messages["reports"];

export const paymentRowShape = z.object({
  created_at: z.string(),
  kind: z.enum(["payment", "reversal"]),
  last_name: z.string(),
  first_name: z.string(),
  group_name: z.string().nullable(),
  amount: z.number().int(),
  method: z.enum(["cash", "kaspi", "transfer"]).nullable(),
  period_start: z.string(),
  period_end: z.string(),
  reason: z.string().nullable(),
  reversed: z.boolean(),
  created_by: z.string().nullable(),
});

export const clientRowShape = z.object({
  last_name: z.string(),
  first_name: z.string(),
  phone: z.string(),
  phone_owner: z.enum(["self", "parent"]),
  parent_name: z.string().nullable(),
  birth_date: z.string().nullable(),
  group_name: z.string().nullable(),
  started_on: z.string(),
  status: z.enum(["active", "expiring", "expired", "none"]),
  ends_on: z.string().nullable(),
  archived: z.boolean(),
  note: z.string(),
});

export type PaymentRow = z.infer<typeof paymentRowShape>;
export type ClientRow = z.infer<typeof clientRowShape>;

type Table = {
  header: readonly string[];
  rows: XlsxCell[][];
  widths: number[];
};

const yesNo = (t: ReportTexts["file"], value: boolean) =>
  value ? t.yes : t.no;

export function paymentsTable(
  rows: readonly PaymentRow[],
  texts: ReportTexts,
): Table {
  const t = texts.file;
  return {
    header: t.paymentsHeader,
    widths: [17, 9, 16, 14, 20, 13, 11, 11, 11, 10, 30, 22],
    rows: rows.map((row) => [
      businessDateTime(new Date(row.created_at)),
      t.kinds[row.kind],
      row.last_name,
      row.first_name,
      row.group_name,
      row.amount,
      row.method ? texts.byMethod.methods[row.method] : null,
      row.period_start,
      row.period_end,
      row.kind === "payment" ? yesNo(t, row.reversed) : null,
      row.reason,
      row.created_by,
    ]),
  };
}

export function clientsTable(
  rows: readonly ClientRow[],
  texts: ReportTexts,
): Table {
  const t = texts.file;
  return {
    header: t.clientsHeader,
    widths: [16, 14, 14, 11, 16, 12, 20, 12, 15, 12, 8, 30],
    rows: rows.map((row) => [
      row.last_name,
      row.first_name,
      row.phone,
      t.phoneOwners[row.phone_owner],
      row.parent_name,
      row.birth_date,
      row.group_name,
      row.started_on,
      t.statuses[row.status],
      row.ends_on,
      yesNo(t, row.archived),
      row.note,
    ]),
  };
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
};

/**
 * The file in the asked format. `baseName` names the file without personal data
 * ("payments-2026-11"); the extension follows the format.
 */
export function buildExportFile(
  table: Table,
  format: ExportFormat,
  baseName: string,
  sheetName: string,
): ExportFile {
  const body =
    format === "xlsx"
      ? new Uint8Array(toXlsx({ sheetName, ...table }))
      : new TextEncoder().encode(
          toCsv([
            table.header,
            ...table.rows.map((row) =>
              row.map((cell) => (cell === null ? "" : String(cell))),
            ),
          ]),
        );
  return {
    fileName: `${baseName}.${format}`,
    contentType: CONTENT_TYPES[format],
    body,
  };
}
