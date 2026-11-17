// Limits shared by the upload form (in the browser) and the server checks. No Zod or parsers here,
// so the form does not pull them into its route's first load.

/** Largest file accepted: a notebook of a few hundred clients is far below this. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Data rows per file; import_clients() refuses more as well. */
export const MAX_ROWS = 2000;

/** Groups the import may create at once; import_clients() refuses more as well. */
export const MAX_NEW_GROUPS = 50;

/** What the file picker offers. */
export const ACCEPTED_FILES =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Columns of the import file, in the order of the template. */
export const COLUMN_KEYS = [
  "lastName",
  "firstName",
  "phone",
  "group",
  "endsOn",
  "locale",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** Without these a row cannot become a client. */
export const REQUIRED_COLUMNS: readonly ColumnKey[] = [
  "lastName",
  "firstName",
  "phone",
];

/** Column index in the file for each field; null when the file has no such column. */
export type ColumnMapping = Record<ColumnKey, number | null>;

export const GROUP_PRICE_MAX = 10_000_000;
