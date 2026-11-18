// Instant search over a list that is already in the browser: names and phone numbers.

/**
 * Kazakh letters and ё folded to the Russian letters people type instead. Both the list and the
 * query are folded, so "қас", "кас" and "КАС" all find "Қасымов".
 */
const FOLD: Record<string, string> = {
  ё: "е",
  қ: "к",
  ғ: "г",
  ң: "н",
  ө: "о",
  ұ: "у",
  ү: "у",
  һ: "х",
  і: "и",
  ә: "а",
};

const FOLDABLE = /[ёқғңөұүһіә]/g;

/** Lower case with Kazakh letters and ё folded: the form both sides are compared in. */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(FOLDABLE, (letter) => FOLD[letter] ?? letter);
}

/** Only the digits: phones are matched however they were typed ("+7 701 123", "7011234"). */
export function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

export type SearchQuery = {
  /** Folded words; each must occur in the name. */
  words: string[];
  /** Digits typed; they must occur in the phone. Empty when no digits were typed. */
  digits: string;
};

export type Searchable = {
  /** normalizeSearch("Фамилия Имя") */
  text: string;
  /** digitsOf() of each phone, separated by spaces so a match never spans two numbers. */
  digits: string;
};

export function parseQuery(query: string): SearchQuery {
  const folded = normalizeSearch(query);
  const words = folded.split(/[^\p{L}]+/u).filter((word) => word.length > 0);
  return { words, digits: digitsOf(folded) };
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return query.words.length === 0 && query.digits.length === 0;
}

/** `phones`: the client's own and, for a child, the parent's; null ones are skipped. */
export function toSearchable(
  name: string,
  phones: string | readonly (string | null)[],
): Searchable {
  const list = typeof phones === "string" ? [phones] : phones;
  return {
    text: normalizeSearch(name),
    digits: list
      .filter((phone): phone is string => phone !== null)
      .map(digitsOf)
      .join(" "),
  };
}

/**
 * Every typed word is part of the name, and the typed digits are part of the phone. A number
 * typed the local way ("8 701 …") is also tried with the country code 7.
 */
export function matchesQuery(entry: Searchable, query: SearchQuery): boolean {
  if (!query.words.every((word) => entry.text.includes(word))) return false;
  if (query.digits.length === 0) return true;
  if (entry.digits.includes(query.digits)) return true;
  return (
    query.digits.startsWith("8") &&
    entry.digits.includes(`7${query.digits.slice(1)}`)
  );
}
