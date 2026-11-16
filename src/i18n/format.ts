import { INTL_LOCALE, type Locale } from "@/lib/locale";

/**
 * Texts are plain data (strings, string lists and plural forms), never functions: a page can hand
 * the texts its client islands need over the server/client boundary, and translators edit one
 * shape. Parameters are written as {name}.
 */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many";

/** Forms by Intl.PluralRules category; `other` is required, Kazakh and Uzbek need little else. */
export type Plural = { readonly other: string } & {
  readonly [C in PluralCategory]?: string;
};

export type Params = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([a-z][a-zA-Z0-9]*)\}/g;

/** "Выбрано: {count}" with { count: 3 } gives "Выбрано: 3". An unknown name stays as written. */
export function fmt(template: string, params: Params): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_LOCALE[locale]);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/** The form for `count` in the language, with {count} and any other parameters filled in. */
export function plural(
  locale: Locale,
  forms: Plural,
  count: number,
  params: Params = {},
): string {
  const category = rulesFor(locale).select(count);
  const form = category === "other" ? forms.other : forms[category];
  return fmt(form ?? forms.other, { ...params, count });
}

/** Parameter names of a template, for the test that translations keep them. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}
