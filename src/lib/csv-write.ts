// CSV for people to open in Excel: ";" (what Excel expects in a Russian locale), CRLF and a UTF-8
// BOM so Cyrillic is not shown as mojibake.

const BOM = "﻿";

function field(value: string, delimiter: string): string {
  // A leading =, +, - or @ makes Excel run the cell as a formula; a quote mark keeps it text.
  const safe =
    /^[=+\-@]/.test(value) && !/^[+-]?\d[\d\s()-]*$/.test(value)
      ? `'${value}`
      : value;
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
