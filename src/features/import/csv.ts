// CSV as Excel saves it in Kazakhstan: UTF-8 (often with a BOM) or Windows-1251, separated by ";"
// (Russian locale) or "," (English locale), fields optionally in double quotes.

const BOM = "﻿";

/**
 * Text of the file. Valid UTF-8 is read as UTF-8; anything else is taken as Windows-1251, the
 * encoding Excel uses for "CSV" on a Russian Windows.
 */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1251").decode(bytes);
  }
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** The separator used in the first line outside quotes: ";", "," or a tab, whichever is most. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>([
    [";", 0],
    [",", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char))
      counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ";";
  for (const [char, count] of counts)
    if (count > (counts.get(best) ?? 0)) best = char;
  return best;
}

/** Rows of fields. Quoted fields may hold the separator, line breaks and doubled quotes. */
export function parseCsv(
  text: string,
  delimiter = detectDelimiter(text),
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
