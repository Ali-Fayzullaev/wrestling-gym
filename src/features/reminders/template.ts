import { formatAmount, formatDate } from "@/lib/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

import type { ReminderKind } from "./kinds";

/** What a template may contain; anything else in braces is left as written. */
export const TEMPLATE_VARIABLES = [
  "имя",
  "дата_окончания",
  "сумма",
  "группа",
  "название_зала",
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
  /** clients.message_locale: the language the client reads reminders in (D-13). */
  messageLocale: Locale;
  phoneOwner: "self" | "parent";
  parentName: string | null;
  groupName: string | null;
  price: number | null;
  /** YYYY-MM-DD, end of the current subscription. */
  endsOn: string | null;
};

/** A reminder template: a text for one kind in one language. */
export type ReminderTemplate = {
  id: string;
  kind: ReminderKind;
  locale: Locale;
  body: string;
  /** False while nobody has edited the shipped text (a Kazakh or Uzbek one is then a draft). */
  edited: boolean;
};

/** A shipped Kazakh or Uzbek text nobody has edited yet: a draft translation (D-13). */
export function isDraftTemplate(template: ReminderTemplate): boolean {
  return template.locale !== DEFAULT_LOCALE && !template.edited;
}

/**
 * The template of `kind` in `locale` (the client's language, or the one chosen for this message),
 * or the Russian one when that language has none; null without either. The same rule as
 * reminder_template_for() in the database, which records the template of an opened chat.
 */
export function pickTemplate(
  templates: readonly ReminderTemplate[],
  kind: ReminderKind,
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
 * A child's phone belongs to a parent, so the text greets the parent by name when it is known.
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
    имя:
      contact.phoneOwner === "parent" && contact.parentName
        ? contact.parentName
        : contact.firstName,
    дата_окончания: contact.endsOn
      ? formatDate(contact.endsOn, today, locale)
      : null,
    сумма: contact.price === null ? null : formatAmount(contact.price, locale),
    группа: contact.groupName,
    название_зала: gymName,
  };
}
