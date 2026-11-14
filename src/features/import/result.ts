import type { FileError } from "./file";
import type { ColumnKey, ColumnMapping } from "./limits";
import type { PreviewRow, RowError, RowStatus } from "./rows";

/** Errors an import action reports to the screen: codes only, never internal details. */
export type ImportError =
  | FileError
  | "forbidden"
  | "invalid"
  | "mapping_incomplete"
  | "groups_unresolved"
  | "group_not_found"
  | "coach_not_found"
  | "rate_limited"
  | "unavailable";

export type ImportResult<T> =
  { ok: true; data: T } | { ok: false; error: ImportError };

export type Option = { id: string; name: string };

/** What to do with a group name from the file that matches no active group. */
export type GroupChoice =
  | { kind: "none" }
  | { kind: "existing"; groupId: string }
  | { kind: "create"; coachId: string; price: number };

/** Keyed by groupKey(name) from rows.ts. */
export type GroupChoices = Record<string, GroupChoice>;

export type PreviewData = {
  /** Header row as written, for choosing columns by hand. */
  headers: string[];
  mapping: ColumnMapping;
  /** Required fields still without a column; rows are empty until they are chosen. */
  missing: ColumnKey[];
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
  unknownGroups: string[];
  groups: Option[];
  coaches: Option[];
  /** ISO instant this very file was imported before, or null. */
  importedAt: string | null;
};

/** A row left out of the import, as it was in the file, for the "fix and re-import" file. */
export type SkippedRow = { line: number; cells: string[]; errors: RowError[] };

export type ImportReport = {
  created: number;
  duplicates: number;
  groupsCreated: number;
  headers: string[];
  skipped: SkippedRow[];
};
