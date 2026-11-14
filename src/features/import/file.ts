import { decodeCsv, parseCsv } from "./csv";
import { MAX_FILE_BYTES, MAX_ROWS } from "./limits";
import { type Cell, readXlsx, XlsxError } from "./xlsx";

/** Why a file cannot be read; the screen explains each in plain words. */
export type FileError =
  | "empty"
  | "too_large"
  | "old_excel"
  | "unsupported"
  | "unreadable"
  | "no_rows"
  | "too_many_rows";

export type Upload = { name: string; bytes: Uint8Array };

export type Table = {
  headers: string[];
  /** Data rows that have at least one value; line = row number in the file (1-based). */
  rows: { line: number; cells: Cell[] }[];
};

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
// .xls (Excel 97-2003) is an OLE compound file.
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((byte, index) => bytes[index] === byte);

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export type FileKind = "csv" | "xlsx";

/** The format by content, not only by name: a renamed file is still refused or read correctly. */
export function detectFileKind(
  upload: Upload,
): { ok: true; kind: FileKind } | { ok: false; error: FileError } {
  const { bytes } = upload;
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "too_large" };
  const ext = extension(upload.name);
  if (startsWith(bytes, OLE_MAGIC) || ext === "xls")
    return { ok: false, error: "old_excel" };
  if (startsWith(bytes, ZIP_MAGIC))
    return ext === "xlsx"
      ? { ok: true, kind: "xlsx" }
      : { ok: false, error: "unsupported" };
  if (ext !== "csv" && ext !== "txt")
    return { ok: false, error: "unsupported" };
  // Text has no NUL bytes; images, PDFs and other binaries almost always do early on.
  if (bytes.subarray(0, 4096).includes(0))
    return { ok: false, error: "unsupported" };
  return { ok: true, kind: "csv" };
}

const isBlank = (cell: Cell) =>
  cell === null || (typeof cell === "string" && cell.trim() === "");

/** A cell as text; whole numbers without exponent (an unformatted phone column is a number). */
export function cellText(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "number")
    return Number.isInteger(cell) ? cell.toFixed(0) : String(cell);
  return cell.trim();
}

/** The first non-empty row is the header; empty rows below it are left out. */
export function toTable(grid: readonly Cell[][]): Table | null {
  const headerIndex = grid.findIndex((row) => !row.every(isBlank));
  if (headerIndex === -1) return null;
  const headers = (grid[headerIndex] ?? []).map(cellText);
  const rows: Table["rows"] = [];
  grid.forEach((cells, index) => {
    if (index > headerIndex && !cells.every(isBlank))
      rows.push({ line: index + 1, cells });
  });
  return { headers, rows };
}

export function readTable(
  upload: Upload,
): { ok: true; table: Table } | { ok: false; error: FileError } {
  const kind = detectFileKind(upload);
  if (!kind.ok) return kind;
  let grid: Cell[][];
  try {
    grid =
      kind.kind === "xlsx"
        ? readXlsx(upload.bytes)
        : parseCsv(decodeCsv(upload.bytes));
  } catch (error) {
    if (error instanceof XlsxError) return { ok: false, error: "unreadable" };
    throw error;
  }
  const table = toTable(grid);
  if (!table || table.rows.length === 0) return { ok: false, error: "no_rows" };
  if (table.rows.length > MAX_ROWS)
    return { ok: false, error: "too_many_rows" };
  return { ok: true, table };
}
