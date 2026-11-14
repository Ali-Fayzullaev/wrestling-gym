import { unzipSync } from "fflate";

// A minimal reader of the first worksheet of an .xlsx file: values only, no styles or formulas.
// An .xlsx is a zip of XML files; fflate unzips it (small, no dependencies) and the few XML shapes
// needed here are read directly. Server only: it never reaches the browser bundle.

/** A cell as stored: text, a number (Excel keeps dates as day numbers) or empty. */
export type Cell = string | number | null;

/** The file is not a readable workbook (damaged, encrypted, too big when unpacked). */
export class XlsxError extends Error {}

// Unpacked sizes are declared by the zip and fflate never inflates past them, so these caps bound
// the memory a crafted file ("zip bomb") can claim.
const MAX_PART_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

// A sheet with data far below this has more rows than an import takes anyway (MAX_ROWS); the cap
// keeps a crafted row number from allocating millions of empty rows. Columns past the cap are
// never import fields.
const MAX_SHEET_ROWS = 5000;
const MAX_SHEET_COLUMNS = 100;

const WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS = "xl/sharedStrings.xml";

function isNeeded(name: string): boolean {
  return (
    name === WORKBOOK ||
    name === WORKBOOK_RELS ||
    name === SHARED_STRINGS ||
    (name.startsWith("xl/worksheets/") && name.endsWith(".xml"))
  );
}

function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        if (!isNeeded(file.name)) return false;
        total += file.originalSize;
        if (file.originalSize > MAX_PART_BYTES || total > MAX_TOTAL_BYTES)
          throw new XlsxError("workbook too large");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof XlsxError) throw error;
    throw new XlsxError("not a zip archive");
  }
}

const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

const MAX_CODE_POINT = 0x10ffff;

function fromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code > MAX_CODE_POINT)
    throw new XlsxError("bad character reference");
  return String.fromCodePoint(code);
}

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name] ?? whole;
  });
}

/** Text of all <t> runs, without phonetic hints (<rPh>) that Excel adds to some strings. */
function runsText(xml: string): string {
  const visible = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of visible.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
    text += match[1] ?? "";
  return decodeXml(text);
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map(
    (match) => runsText(match[1] ?? ""),
  );
}

/** Path of the first sheet in the workbook's order. */
function firstSheetPath(
  files: Record<string, Uint8Array>,
  text: (name: string) => string | undefined,
): string {
  const workbook = text(WORKBOOK);
  const rels = text(WORKBOOK_RELS);
  const sheetId = workbook?.match(/<sheet\b[^>]*?\b\w+:id="([^"]+)"/)?.[1];
  if (sheetId && rels) {
    for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = match[0];
      if (tag.match(/\bId="([^"]+)"/)?.[1] !== sheetId) continue;
      const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
      if (!target) break;
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (files[path]) return path;
    }
  }
  const fallback = Object.keys(files)
    .filter((name) => name.startsWith("xl/worksheets/"))
    .sort()[0];
  if (!fallback) throw new XlsxError("no worksheet");
  return fallback;
}

/** "AB" -> 27 (zero-based column index). */
function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function cellValue(
  attrs: string,
  body: string,
  shared: readonly string[],
): Cell {
  const type = attrs.match(/\bt="(\w+)"/)?.[1] ?? "n";
  if (type === "inlineStr") return runsText(body);
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return null;
  const value = decodeXml(raw);
  switch (type) {
    case "s":
      return shared[Number(value)] ?? null;
    case "n": {
      const number = Number(value);
      return value.trim() === "" || Number.isNaN(number) ? null : number;
    }
    case "b":
      return value === "1" ? "TRUE" : "FALSE";
    case "e":
      return null;
    default:
      // "str" (formula result) and "d" (ISO date) are text.
      return value;
  }
}

/**
 * Rows of the first worksheet; index = sheet row number - 1, so line numbers match what Excel
 * shows. Missing cells are null.
 */
export function readXlsx(bytes: Uint8Array): Cell[][] {
  const files = unpack(bytes);
  const decoder = new TextDecoder("utf-8");
  const text = (name: string) => {
    const file = files[name];
    return file ? decoder.decode(file) : undefined;
  };
  const shared = readSharedStrings(text(SHARED_STRINGS));
  const sheet = text(firstSheetPath(files, text));
  if (sheet === undefined) throw new XlsxError("no worksheet");

  const rows: Cell[][] = [];
  let nextRow = 0;
  for (const rowMatch of sheet.matchAll(
    /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,
  )) {
    const rowNumber = Number(
      rowMatch[1]?.match(/\br="(\d+)"/)?.[1] ?? nextRow + 1,
    );
    const rowIndex = rowNumber - 1;
    nextRow = rowNumber;
    if (rowIndex >= MAX_SHEET_ROWS) break;
    const cells: Cell[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attrs = cellMatch[1] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const column = ref ? columnIndex(ref) : nextColumn;
      nextColumn = column + 1;
      if (column >= MAX_SHEET_COLUMNS) continue;
      const value = cellValue(attrs, cellMatch[2] ?? "", shared);
      while (cells.length < column) cells.push(null);
      cells[column] = value;
    }
    if (cells.every((cell) => cell === null || cell === "")) continue;
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}
