import { createHash } from "node:crypto";

import { z } from "zod";

import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";
import { businessDate } from "@/lib/dates";

import { matchHeaders, missingColumns } from "./columns";
import { cellText, readTable, type Table, type Upload } from "./file";
import { groupKey } from "./group-key";
import type { ColumnMapping } from "./limits";
import type {
  GroupChoices,
  ImportError,
  ImportReport,
  ImportResult,
  PreviewData,
} from "./result";
import {
  buildPreview,
  countRows,
  type PreviewRow,
  unknownGroups,
} from "./rows";

// Shapes of import_context() / import_clients() (supabase/migrations/*_client_import.sql). The
// database returns jsonb, so the reply is checked rather than trusted.
const option = z.object({ id: z.string(), name: z.string() });
const contextShape = z.object({
  existing: z.array(
    z.object({
      phone: z.string(),
      last_name: z.string(),
      first_name: z.string(),
    }),
  ),
  groups: z.array(option),
  coaches: z.array(option),
  imported_at: z.string().nullable(),
});
const importShape = z.object({
  created: z.number(),
  duplicates: z.number(),
  groups_created: z.number(),
});

/** SHA-256 of the file: recorded in the audit log, so a repeated file is recognised. */
export function fileHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Postgres errors raised by the import functions, mapped to what the screen can say. */
function importError(error: { code?: string; message?: string }): ImportError {
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0001" && error.message === "rate_limited")
    return "rate_limited";
  if (error.code === "P0002")
    return error.message === "coach_not_found"
      ? "coach_not_found"
      : "group_not_found";
  if (
    error.code === "22023" ||
    error.code === "23514" ||
    error.code === "22P02"
  )
    return "invalid";
  return "unavailable";
}

function mappingFits(mapping: ColumnMapping, table: Table): boolean {
  const width = Math.max(
    table.headers.length,
    ...table.rows.map((row) => row.cells.length),
  );
  return Object.values(mapping).every(
    (index) => index === null || index < width,
  );
}

type Prepared = {
  table: Table;
  mapping: ColumnMapping;
  hash: string;
  data: PreviewData;
};

/** Reads the file, matches columns (or takes the given ones) and classifies every row. */
async function prepare(
  db: Db,
  upload: Upload,
  requested: ColumnMapping | null,
): Promise<ImportResult<Prepared>> {
  const read = readTable(upload);
  if (!read.ok) return read;
  const { table } = read;
  const mapping = requested ?? matchHeaders(table.headers);
  if (!mappingFits(mapping, table)) return { ok: false, error: "invalid" };
  const missing = missingColumns(mapping);
  const hash = fileHash(upload.bytes);

  // Rows are only read once the required columns are known; the phones go to the database in
  // the request body (an RPC), never in a URL.
  const draft =
    missing.length === 0
      ? buildPreview(table, mapping, { existing: [], groups: [] })
      : [];
  const phones = [
    ...new Set(draft.filter((r) => r.status !== "error").map((r) => r.phone)),
  ];
  const { data, error } = await db.rpc("import_context", {
    p_phones: phones,
    p_file_hash: hash,
  });
  if (error) return { ok: false, error: importError(error) };
  const context = contextShape.parse(data);

  const rows =
    missing.length === 0
      ? buildPreview(table, mapping, {
          existing: context.existing.map((c) => ({
            phone: c.phone,
            lastName: c.last_name,
            firstName: c.first_name,
          })),
          groups: context.groups,
        })
      : [];
  return {
    ok: true,
    data: {
      table,
      mapping,
      hash,
      data: {
        headers: table.headers,
        mapping,
        missing,
        rows,
        counts: countRows(rows),
        unknownGroups: unknownGroups(rows),
        groups: context.groups,
        coaches: context.coaches,
        importedAt: context.imported_at,
      },
    },
  };
}

const isOwner = (actor: Actor) => actor.role === "owner";

/** The preview: columns, every row with its status, groups to decide about. Writes nothing. */
export async function previewImport(
  db: Db,
  actor: Actor,
  upload: Upload,
  mapping: ColumnMapping | null,
): Promise<ImportResult<PreviewData>> {
  // STUB(D-09): owner only until the customer says whether admins may import.
  if (!isOwner(actor)) return { ok: false, error: "forbidden" };
  const prepared = await prepare(db, upload, mapping);
  return prepared.ok ? { ok: true, data: prepared.data.data } : prepared;
}

type ImportRow = {
  line: number;
  last_name: string;
  first_name: string;
  phone: string;
  group_id: string | null;
  new_group: string | null;
  ends_on: string | null;
};

type NewGroup = { name: string; coach_id: string; price: number };

/** Rows to create and groups to create for them, or null when a group has no decision. */
export function planImport(
  rows: readonly PreviewRow[],
  choices: GroupChoices,
): { rows: ImportRow[]; newGroups: NewGroup[] } | null {
  const planned: ImportRow[] = [];
  const newGroups = new Map<string, NewGroup>();
  for (const row of rows) {
    if (row.status !== "new") continue;
    let groupId = row.groupId;
    let newGroup: string | null = null;
    if (row.groupName !== "" && groupId === null) {
      const key = groupKey(row.groupName);
      const choice = choices[key];
      if (!choice) return null;
      if (choice.kind === "existing") groupId = choice.groupId;
      if (choice.kind === "create") {
        const group = newGroups.get(key) ?? {
          name: row.groupName,
          coach_id: choice.coachId,
          price: choice.price,
        };
        newGroups.set(key, group);
        newGroup = group.name;
      }
    }
    planned.push({
      line: row.line,
      last_name: row.lastName,
      first_name: row.firstName,
      phone: row.phone,
      group_id: groupId,
      new_group: newGroup,
      ends_on: row.endsOn,
    });
  }
  return { rows: planned, newGroups: [...newGroups.values()] };
}

/** Rows with errors as they were in the file, for the "fix and import again" download. */
function skippedRows(
  table: Table,
  rows: readonly PreviewRow[],
): ImportReport["skipped"] {
  const byLine = new Map(table.rows.map((row) => [row.line, row.cells]));
  return rows
    .filter((row) => row.status === "error")
    .map((row) => ({
      line: row.line,
      cells: (byLine.get(row.line) ?? []).map(cellText),
      errors: row.errors,
    }));
}

/**
 * Imports the file in one transaction. The file is read again here, never trusted from the
 * preview: rows with errors are skipped, duplicates are skipped by import_clients() as well.
 */
export async function commitImport(
  db: Db,
  now: Date,
  actor: Actor,
  upload: Upload,
  mapping: ColumnMapping,
  choices: GroupChoices,
): Promise<ImportResult<ImportReport>> {
  // STUB(D-09): owner only until the customer says whether admins may import.
  if (!isOwner(actor)) return { ok: false, error: "forbidden" };
  const prepared = await prepare(db, upload, mapping);
  if (!prepared.ok) return prepared;
  const { table, hash, data: preview } = prepared.data;
  if (preview.missing.length > 0)
    return { ok: false, error: "mapping_incomplete" };
  const plan = planImport(preview.rows, choices);
  if (!plan) return { ok: false, error: "groups_unresolved" };

  const report = {
    headers: table.headers,
    skipped: skippedRows(table, preview.rows),
  };
  if (plan.rows.length === 0)
    return {
      ok: true,
      data: {
        ...report,
        created: 0,
        duplicates: preview.counts.duplicate,
        groupsCreated: 0,
      },
    };

  const { data, error } = await db.rpc("import_clients", {
    p_file_hash: hash,
    p_rows: plan.rows,
    p_new_groups: plan.newGroups,
    p_today: businessDate(now),
  });
  if (error) return { ok: false, error: importError(error) };
  const result = importShape.parse(data);
  return {
    ok: true,
    data: {
      ...report,
      created: result.created,
      duplicates: preview.counts.duplicate + result.duplicates,
      groupsCreated: result.groups_created,
    },
  };
}
