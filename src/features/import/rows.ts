import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { normalizePhone } from "@/lib/phone";

import { parseEndDate } from "./dates";
import { cellText, type Table } from "./file";
import { groupKey } from "./group-key";
import type { ColumnMapping } from "./limits";
import { parseMessageLocale } from "./locale";
import type { Cell } from "./xlsx";

/** What is wrong with a row; the screen shows the text next to it. */
export type RowError =
  | "last_name_missing"
  | "first_name_missing"
  | "name_too_long"
  | "phone_missing"
  | "phone_invalid"
  | "date_invalid"
  | "locale_invalid";

/** new: will be created; duplicate: already on file or earlier in this file; error: skipped. */
export type RowStatus = "new" | "duplicate" | "error";

/**
 * A row with a parent (D-18): "found" when a current parent with this phone and name is on file,
 * "new" when the import creates one (rows of one parent share it); "none" for an adult.
 */
export type ParentStatus = "none" | "new" | "found";

export type PreviewRow = {
  line: number;
  lastName: string;
  firstName: string;
  /** +77XXXXXXXXX when valid, otherwise as written. */
  phone: string;
  /** Group as written in the file, "" for none. */
  groupName: string;
  /** The active group with that name, or null (none written, or not found). */
  groupId: string | null;
  endsOn: string | null;
  /** Language of the client's reminders; Russian when the file says nothing. */
  messageLocale: Locale;
  /** The parent's name as written, "" for an adult. The phone is then the parent's. */
  parentName: string;
  parentStatus: ParentStatus;
  status: RowStatus;
  errors: RowError[];
  /** Line of the earlier row in this file with the same person; null when already on file. */
  duplicateOf: number | null;
};

export type ExistingClient = {
  phone: string;
  lastName: string;
  firstName: string;
};
export type GroupRef = { id: string; name: string };
export type ExistingParent = { phone: string; name: string };

/** Same as clients.last_name / first_name in the database: 1..100 characters. */
const NAME_MAX = 100;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** One parent per phone and name, case and spaces aside (import_clients() agrees). */
export function parentKey(phone: string, name: string): string {
  return [phone, collapse(name).toLowerCase()].join("|");
}

/** Duplicate key: phone + last name + first name, case-insensitive (import_clients() agrees). */
export function duplicateKey(
  phone: string,
  lastName: string,
  firstName: string,
): string {
  return [phone, lastName.toLowerCase(), firstName.toLowerCase()].join("|");
}

function cellAt(cells: readonly Cell[], index: number | null): Cell {
  return index === null ? null : (cells[index] ?? null);
}

/** Reads, checks and classifies every data row against what is already on file. */
export function buildPreview(
  table: Table,
  mapping: ColumnMapping,
  context: {
    existing: readonly ExistingClient[];
    groups: readonly GroupRef[];
    parents?: readonly ExistingParent[];
  },
): PreviewRow[] {
  const parentsOnFile = new Set(
    (context.parents ?? []).map((p) => parentKey(p.phone, p.name)),
  );
  const onFile = new Set(
    context.existing.map((c) => duplicateKey(c.phone, c.lastName, c.firstName)),
  );
  const groupsByName = new Map(
    context.groups.map((g) => [groupKey(g.name), g.id]),
  );
  const seen = new Map<string, number>();

  return table.rows.map(({ line, cells }) => {
    const text = (index: number | null) =>
      collapse(cellText(cellAt(cells, index)));
    const lastName = text(mapping.lastName);
    const firstName = text(mapping.firstName);
    const rawPhone = text(mapping.phone);
    const groupName = text(mapping.group);
    const date = parseEndDate(cellAt(cells, mapping.endsOn));
    const phone = normalizePhone(rawPhone);
    const messageLocale = parseMessageLocale(text(mapping.locale));
    const parentName = text(mapping.parent);

    const errors: RowError[] = [];
    if (lastName === "") errors.push("last_name_missing");
    if (firstName === "") errors.push("first_name_missing");
    if (
      lastName.length > NAME_MAX ||
      firstName.length > NAME_MAX ||
      parentName.length > NAME_MAX
    )
      errors.push("name_too_long");
    if (rawPhone === "") errors.push("phone_missing");
    else if (phone === null) errors.push("phone_invalid");
    if (!date.ok) errors.push("date_invalid");
    if (!messageLocale.ok) errors.push("locale_invalid");

    const row: PreviewRow = {
      line,
      lastName,
      firstName,
      phone: phone ?? rawPhone,
      groupName,
      groupId:
        groupName === ""
          ? null
          : (groupsByName.get(groupKey(groupName)) ?? null),
      endsOn: date.ok ? date.value : null,
      messageLocale: messageLocale.ok ? messageLocale.value : DEFAULT_LOCALE,
      parentName,
      parentStatus:
        parentName === "" || phone === null
          ? "none"
          : parentsOnFile.has(parentKey(phone, parentName))
            ? "found"
            : "new",
      status: "new",
      errors,
      duplicateOf: null,
    };
    // A skipped row creates no parent either.
    if (errors.length > 0 || phone === null)
      return { ...row, status: "error", parentStatus: "none" };

    const key = duplicateKey(phone, lastName, firstName);
    const earlier = seen.get(key);
    if (onFile.has(key)) return { ...row, status: "duplicate" };
    if (earlier !== undefined)
      return { ...row, status: "duplicate", duplicateOf: earlier };
    seen.set(key, line);
    return row;
  });
}

/** Group names written in the file that match no active group: the owner decides about each. */
export function unknownGroups(rows: readonly PreviewRow[]): string[] {
  const names = new Map<string, string>();
  for (const row of rows)
    if (row.status === "new" && row.groupName !== "" && row.groupId === null) {
      const key = groupKey(row.groupName);
      if (!names.has(key)) names.set(key, row.groupName);
    }
  return [...names.values()];
}

export function countRows(
  rows: readonly PreviewRow[],
): Record<RowStatus, number> {
  const counts: Record<RowStatus, number> = { new: 0, duplicate: 0, error: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
