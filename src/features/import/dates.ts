import type { Cell } from "./xlsx";

export type ParsedDate = { ok: true; value: string | null } | { ok: false };

// Excel keeps dates as day numbers counted from 30 December 1899 (this epoch absorbs Excel's
// fictional 29 February 1900). Numbers outside 1954..2119 are not dates anyone means here.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const SERIAL_MIN = 20_000;
const SERIAL_MAX = 80_000;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

const pad = (value: number) => String(value).padStart(2, "0");

/** YYYY-MM-DD when the parts form a real calendar date in range, else null. */
function isoDate(year: number, month: number, day: number): string | null {
  if (year < YEAR_MIN || year > YEAR_MAX) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function fromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < SERIAL_MIN || serial > SERIAL_MAX)
    return null;
  const date = new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * DAY_MS);
  return isoDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

const DAY_FIRST = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+Z?)?$/;
const SERIAL = /^\d{5}(?:[.,]\d+)?$/;

/**
 * The subscription end date of a cell: "18.11.2025", "18/11/25", "2025-11-18" or an Excel day
 * number (a cell formatted as a date, or saved to CSV as a number). Empty means "no date".
 */
export function parseEndDate(cell: Cell): ParsedDate {
  if (cell === null) return { ok: true, value: null };
  if (typeof cell === "number") {
    const value = fromSerial(cell);
    return value ? { ok: true, value } : { ok: false };
  }
  const text = cell.trim();
  if (text === "") return { ok: true, value: null };

  let value: string | null = null;
  const dayFirst = DAY_FIRST.exec(text);
  const iso = ISO.exec(text);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    const fullYear = year?.length === 2 ? 2000 + Number(year) : Number(year);
    value = isoDate(fullYear, Number(month), Number(day));
  } else if (iso) {
    const [, year, month, day] = iso;
    value = isoDate(Number(year), Number(month), Number(day));
  } else if (SERIAL.test(text)) {
    value = fromSerial(Number(text.replace(",", ".")));
  }
  return value ? { ok: true, value } : { ok: false };
}
