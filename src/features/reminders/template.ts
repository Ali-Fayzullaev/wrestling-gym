import { formatAmount, formatDate } from "@/lib/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

import type { TemplateKind } from "./kinds";

/** What a template may contain; anything else in braces is left as written. */
export const TEMPLATE_VARIABLES = [
  "имя",
  "дата_окончания",
  "сумма",
  "группа",
  "название_зала",
  "дети",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Record<TemplateVariable, string | null>;

const VARIABLE = /\{([^{}\n]*)\}/g;

function isVariable(name: string): name is TemplateVariable {
  return (TEMPLATE_VARIABLES as readonly string[]).includes(name);
}

/**
 * Fills the variables in. A value that is missing (no group, so no price) becomes empty and the
 * spaces around it are tidied, so the text never has double spaces or a space before a comma.
 */
export function renderTemplate(body: string, values: TemplateValues): string {
  const filled = body.replace(VARIABLE, (token: string, name: string) =>
    isVariable(name) ? (values[name] ?? "") : token,
  );
  return tidy(filled);
}

/** `{...}` tokens that are not variables, each once, in order: they stay in the text as typed. */
export function unknownVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(VARIABLE)) {
    if (!isVariable(match[1] ?? "")) found.add(match[0]);
  }
  return [...found];
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/ ([,.!?:;])/g, "$1")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The fields of a client a reminder is built from. */
export type ReminderContact = {
  firstName: string;
  /**
   * The language the message is read in (D-13): the parent's for a child with a parent, otherwise
   * the client's own.
   */
  messageLocale: Locale;
  /** The parent who gets a child's reminders (D-18); null for a client reminded directly. */
  parentName: string | null;
  groupName: string | null;
  price: number | null;
  /** YYYY-MM-DD, end of the current subscription. */
  endsOn: string | null;
};

/** A reminder template: a text for one kind in one language. */
export type ReminderTemplate = {
  id: string;
  kind: TemplateKind;
  locale: Locale;
  body: string;
  /** False while nobody has edited the shipped text (a Kazakh or Uzbek one is then a draft). */
  edited: boolean;
};

/**
 * A shipped text nobody has edited yet that still waits for the customer: a Kazakh or Uzbek
 * translation (D-13), or any of the "several children" texts (D-18).
 */
export function isDraftTemplate(template: ReminderTemplate): boolean {
  return (
    (template.locale !== DEFAULT_LOCALE || template.kind === "family") &&
    !template.edited
  );
}

/**
 * The template of `kind` in `locale` (the client's language, or the one chosen for this message),
 * or the Russian one when that language has none; null without either. The same rule as
 * reminder_template_for() in the database, which records the template of an opened chat.
 */
export function pickTemplate(
  templates: readonly ReminderTemplate[],
  kind: TemplateKind,
  locale: Locale,
): ReminderTemplate | null {
  const ofKind = templates.filter((template) => template.kind === kind);
  return (
    ofKind.find((template) => template.locale === locale) ??
    ofKind.find((template) => template.locale === DEFAULT_LOCALE) ??
    null
  );
}

/**
 * A child's reminder goes to the parent, so the text greets the parent by name.
 * The date and amount are written in the template's language, so a Kazakh text says "16 қаңтар"
 * and a Russian one, also when it stands in for a missing Kazakh text, "16 января".
 */
export function reminderValues(
  contact: ReminderContact,
  gymName: string,
  today: Date,
  locale: Locale,
): TemplateValues {
  return {
    имя: contact.parentName ?? contact.firstName,
    дата_окончания: contact.endsOn
      ? formatDate(contact.endsOn, today, locale)
      : null,
    сумма: contact.price === null ? null : formatAmount(contact.price, locale),
    группа: contact.groupName,
    название_зала: gymName,
    дети: null,
  };
}

/** One child in a message to a parent (D-18). */
export type FamilyChild = {
  firstName: string;
  /** YYYY-MM-DD, end of the child's current subscription. */
  endsOn: string | null;
  /** The child's group price; null without an active group. */
  price: number | null;
};

// One line per child in {дети}. STUB(D-22): drafts until the customer reads them; "до" in Kazakh
// and Uzbek would need the date in another case, so those say "term: <date>" instead.
const FAMILY_LINE: Record<Locale, { date: string; price: string }> = {
  ru: { date: "до {date}", price: "{amount} ₸" },
  kk: { date: "мерзімі {date}", price: "{amount} ₸" },
  uz: { date: "муддати {date}", price: "{amount} ₸" },
};

/** "Арман: до 16 декабря, 15 000 ₸"; without a price or date that part is left out. */
export function familyLine(
  child: FamilyChild,
  today: Date,
  locale: Locale,
): string {
  const words = FAMILY_LINE[locale];
  const parts = [
    child.endsOn
      ? words.date.replace("{date}", formatDate(child.endsOn, today, locale))
      : null,
    child.price === null
      ? null
      : words.price.replace("{amount}", formatAmount(child.price, locale)),
  ].filter((part): part is string => part !== null);
  return parts.length === 0
    ? child.firstName
    : `${child.firstName}: ${parts.join(", ")}`;
}

/**
 * The variables of the "several children" text: the parent is greeted, {дети} lists the children
 * one per line; {дата_окончания}, {сумма} and {группа} have no single value and stay empty.
 */
export function familyValues(
  parentName: string,
  children: readonly FamilyChild[],
  gymName: string,
  today: Date,
  locale: Locale,
): TemplateValues {
  return {
    имя: parentName,
    дата_окончания: null,
    сумма: null,
    группа: null,
    название_зала: gymName,
    дети: children.map((child) => familyLine(child, today, locale)).join("\n"),
  };
}
