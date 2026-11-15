// CSV for people to open in Excel: ";" (what Excel expects in a Russian locale), CRLF and a UTF-8
// BOM so Cyrillic is not shown as mojibake.

const BOM = "﻿";

// A leading =, +, - or @ makes Excel (and other spreadsheets) run the cell as a formula; a tab or
// carriage return in front can hide such a sign. Plain numbers and phone numbers ("+7 701 ...",
// "-5") cannot call anything, so they stay as they are.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d\s()-]*$/;

/** True when a spreadsheet could run this text as a formula. */
export function looksLikeFormula(value: string): boolean {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value);
}

/** The text with a leading quote mark when it could run as a formula, so it stays text. */
export function neutralizeFormula(value: string): string {
  return looksLikeFormula(value) ? `'${value}` : value;
}

function field(value: string, delimiter: string): string {
  const safe = neutralizeFormula(value);
  return /["\r\n]/.test(safe) || safe.includes(delimiter)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

export function toCsv(
  rows: readonly (readonly string[])[],
  delimiter = ";",
): string {
  return (
    BOM +
    rows
      .map((row) => row.map((value) => field(value, delimiter)).join(delimiter))
      .join("\r\n")
  );
}
