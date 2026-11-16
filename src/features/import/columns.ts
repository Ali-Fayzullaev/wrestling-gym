import type { ColumnKey, ColumnMapping } from "./limits";
import { COLUMN_KEYS, REQUIRED_COLUMNS } from "./limits";

// Header names people write in the notebook copy: Russian, Kazakh, Uzbek (Cyrillic) and English. Compared after
// normalizeHeader(), so case, "ё", punctuation and extra spaces do not matter.
const SYNONYMS: Record<ColumnKey, readonly string[]> = {
  lastName: [
    "фамилия",
    "фам",
    "surname",
    "last name",
    "lastname",
    "family name",
    "тегі",
    "фамилияси",
  ],
  firstName: [
    "имя",
    "first name",
    "firstname",
    "given name",
    "name",
    "аты",
    "исм",
    "исми",
  ],
  phone: [
    "телефон",
    "тел",
    "номер телефона",
    "номер",
    "мобильный",
    "whatsapp",
    "ватсап",
    "phone",
    "phone number",
    "mobile",
    "телефон нөмірі",
    "нөмір",
    "телефон рақами",
    "рақам",
  ],
  group: ["группа", "group", "топ", "тобы", "гуруҳ", "гурух"],
  endsOn: [
    "дата окончания",
    "окончание",
    "окончание абонемента",
    "дата окончания абонемента",
    "абонемент до",
    "оплачено до",
    "оплачен до",
    "действует до",
    "до",
    "end date",
    "paid until",
    "valid until",
    "expires",
    "аяқталу күні",
    "аяқталуы",
    "мерзімі",
    "тугаш санаси",
    "тугаш",
    "муддати",
  ],
};

/** Lower case, "ё" as "е", anything but letters and digits as a single space. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const LOOKUP: ReadonlyMap<string, ColumnKey> = new Map(
  COLUMN_KEYS.flatMap((key) =>
    SYNONYMS[key].map((name) => [normalizeHeader(name), key] as const),
  ),
);

/** Which field a header names, or null. "Телефон (мамы)" still reads as a phone. */
export function columnForHeader(header: string): ColumnKey | null {
  const normalized = normalizeHeader(header);
  if (normalized === "") return null;
  const exact = LOOKUP.get(normalized);
  if (exact) return exact;
  for (const [name, key] of LOOKUP)
    if (normalized.startsWith(`${name} `)) return key;
  return null;
}

export function emptyMapping(): ColumnMapping {
  return {
    lastName: null,
    firstName: null,
    phone: null,
    group: null,
    endsOn: null,
  };
}

/** Matches the header row to fields; the first column naming a field wins. */
export function matchHeaders(headers: readonly string[]): ColumnMapping {
  const mapping = emptyMapping();
  headers.forEach((header, index) => {
    const key = columnForHeader(header);
    if (key && mapping[key] === null) mapping[key] = index;
  });
  return mapping;
}

/** Required fields without a column: the screen asks to pick them by hand. */
export function missingColumns(mapping: ColumnMapping): ColumnKey[] {
  return REQUIRED_COLUMNS.filter((key) => mapping[key] === null);
}
