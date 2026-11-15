import { strToU8, zipSync } from "fflate";

import { looksLikeFormula } from "./csv-write";

// A minimal .xlsx writer: one sheet, text and whole numbers, a bold frozen header row. An .xlsx is
// a zip of a few XML parts; fflate zips them. Server only (route handlers), never in the browser.
//
// Text goes in as inline strings, which Excel never evaluates. Text that looks like a formula also
// gets Excel's own "quote prefix" style, so it stays text even when someone edits the cell.

export type XlsxCell = string | number | null;

// Style indexes in STYLES below.
const STYLE_HEADER = 1;
const STYLE_QUOTED = 2;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs></styleSheet>`;

// Characters XML 1.0 does not allow at all (control characters other than tab and line breaks).
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Zero-based column index -> "A", "B", ..., "AA". */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cellXml(cell: XlsxCell, ref: string, header: boolean): string {
  if (cell === null || cell === "") return "";
  if (typeof cell === "number") {
    if (!Number.isFinite(cell))
      throw new RangeError("xlsx cell must be finite");
    return `<c r="${ref}"><v>${cell}</v></c>`;
  }
  const style = header
    ? ` s="${STYLE_HEADER}"`
    : looksLikeFormula(cell)
      ? ` s="${STYLE_QUOTED}"`
      : "";
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
}

function sheetXml(
  header: readonly string[],
  rows: readonly (readonly XlsxCell[])[],
  widths: readonly number[],
): string {
  const cols = widths.length
    ? `<cols>${widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  const body = [header, ...rows]
    .map((cells, r) => {
      const xml = cells
        .map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`, r === 0))
        .join("");
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

function workbookXml(sheetName: string): string {
  // Excel limits sheet names to 31 characters and forbids : \ / ? * [ ].
  const name = sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet1";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

/** A workbook with one sheet: the bold, frozen `header` row, then `rows`. */
export function toXlsx({
  sheetName,
  header,
  rows,
  widths = [],
}: {
  sheetName: string;
  header: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /** Column widths in characters, in column order. */
  widths?: readonly number[];
}): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "xl/workbook.xml": strToU8(workbookXml(sheetName)),
      "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
      "xl/styles.xml": strToU8(STYLES),
      "xl/worksheets/sheet1.xml": strToU8(sheetXml(header, rows, widths)),
    },
    { level: 6 },
  );
}
