import { formatAmount, formatDate } from "@/lib/format";

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
  phoneOwner: "self" | "parent";
  parentName: string | null;
  groupName: string | null;
  price: number | null;
  /** YYYY-MM-DD, end of the current subscription. */
  endsOn: string | null;
};

/** A child's phone belongs to a parent, so the text greets the parent by name when it is known. */
export function reminderValues(
  contact: ReminderContact,
  gymName: string,
  today: Date,
): TemplateValues {
  return {
    имя:
      contact.phoneOwner === "parent" && contact.parentName
        ? contact.parentName
        : contact.firstName,
    дата_окончания: contact.endsOn ? formatDate(contact.endsOn, today) : null,
    сумма: contact.price === null ? null : formatAmount(contact.price),
    группа: contact.groupName,
    название_зала: gymName,
  };
}
