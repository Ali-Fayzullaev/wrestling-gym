import { strToU8, zipSync } from "fflate";

// Builders of import files for tests: a minimal .xlsx (the parts Excel writes for one sheet) and
// CSV bytes in UTF-8 or Windows-1251.

export type FixtureCell =
  string | number | null | { inline: string } | { formula: string };

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** An .xlsx whose first sheet holds `rows`; strings go to sharedStrings.xml like Excel does. */
export function buildXlsx(
  rows: readonly (readonly FixtureCell[])[],
  options: { sheetName?: string } = {},
): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const rowXml = rows
    .map((cells, r) => {
      const cellXml = cells
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (cell === null) return "";
          if (typeof cell === "number")
            return `<c r="${ref}" s="1"><v>${cell}</v></c>`;
          if (typeof cell === "object" && "inline" in cell)
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell.inline)}</t></is></c>`;
          if (typeof cell === "object")
            return `<c r="${ref}" t="str"><f>A1</f><v>${escapeXml(cell.formula)}</v></c>`;
          let index = sharedIndex.get(cell);
          if (index === undefined) {
            index = shared.length;
            shared.push(cell);
            sharedIndex.set(cell, index);
          }
          return `<c r="${ref}" t="s"><v>${index}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cellXml}</row>`;
    })
    .join("");
  const ns =
    'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel =
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook ${ns} ${rel}><sheets><sheet name="${escapeXml(options.sheetName ?? "Лист1")}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet ${ns}><sheetData>${rowXml}</sheetData></worksheet>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><sst ${ns} count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map(
          (text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`,
        )
        .join("")}</sst>`,
    ),
  });
}

/** Windows-1251 bytes of text (Latin, digits, punctuation and Russian letters only). */
export function encodeCp1251(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code >= 0x410 && code <= 0x44f) bytes.push(code - 0x410 + 0xc0);
    else if (char === "Ё") bytes.push(0xa8);
    else if (char === "ё") bytes.push(0xb8);
    else throw new Error(`no cp1251 byte for U+${code.toString(16)}`);
  }
  return Uint8Array.from(bytes);
}

/** CSV text as Excel saves it: rows joined with CRLF, fields quoted when needed. */
export function csvText(
  rows: readonly (readonly string[])[],
  delimiter = ";",
): string {
  return rows
    .map((row) =>
      row
        .map((field) =>
          /["\r\n]/.test(field) || field.includes(delimiter)
            ? `"${field.replaceAll('"', '""')}"`
            : field,
        )
        .join(delimiter),
    )
    .join("\r\n");
}

export const utf8 = (text: string) => new TextEncoder().encode(text);
