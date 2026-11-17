import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

import { normalizeHeader } from "./columns";

export type ParsedLocale = { ok: true; value: Locale } | { ok: false };

// What people write in the "Язык" column: the code, the name in Russian, or the name in the
// language itself. Compared after normalizeHeader(), so case, "ё" and punctuation do not matter.
const NAMES: Record<Locale, readonly string[]> = {
  ru: ["ru", "рус", "русский", "орысша", "русча", "russian"],
  kk: ["kk", "каз", "казахский", "қазақша", "қазақ", "казакша", "kazakh"],
  uz: ["uz", "узб", "узбекский", "ўзбекча", "ўзбек", "узбекча", "uzbek"],
};

const LOOKUP: ReadonlyMap<string, Locale> = new Map(
  (Object.keys(NAMES) as Locale[]).flatMap((locale) =>
    NAMES[locale].map((name) => [normalizeHeader(name), locale] as const),
  ),
);

/** The message language of an import row: empty means Russian, an unknown word is an error. */
export function parseMessageLocale(text: string): ParsedLocale {
  const normalized = normalizeHeader(text);
  if (normalized === "") return { ok: true, value: DEFAULT_LOCALE };
  const locale = LOOKUP.get(normalized);
  return locale ? { ok: true, value: locale } : { ok: false };
}
