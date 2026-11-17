import { describe, expect, it } from "vitest";

import { buildReminderLink, type ReminderContext } from "./service";

const NBSP = " ";
const TODAY = new Date("2026-01-10T06:00:00Z");

const CONTEXT: ReminderContext = {
  gymName: "Зал греко-римской борьбы",
  reminderDays: [7, 1],
  templates: [
    {
      id: "ru",
      kind: "before_7",
      locale: "ru",
      body: "Здравствуйте, {имя}! До {дата_окончания}, {сумма} тенге.",
      edited: false,
    },
    {
      id: "kk",
      kind: "before_7",
      locale: "kk",
      body: "Сәлеметсіз бе, {имя}! {название_зала}: {дата_окончания}, {сумма} теңге.",
      edited: true,
    },
    {
      id: "ru-overdue",
      kind: "overdue",
      locale: "ru",
      body: "{имя}, абонемент закончился {дата_окончания}.",
      edited: false,
    },
  ],
};

const CONTACT = {
  firstName: "Әлихан",
  messageLocale: "kk" as const,
  phoneOwner: "self" as const,
  parentName: null,
  groupName: "Взрослые",
  price: 15000,
  endsOn: "2026-01-16",
  phone: "+77011234567",
};

function textOf(link: string | null): string {
  return link ? (new URL(link).searchParams.get("text") ?? "") : "";
}

describe("buildReminderLink", () => {
  it("opens WhatsApp with the Kazakh text and a Kazakh date for a Kazakh client", () => {
    expect(textOf(buildReminderLink(CONTACT, "before_7", CONTEXT, TODAY))).toBe(
      `Сәлеметсіз бе, Әлихан! Зал греко-римской борьбы: 16${NBSP}қаңтар, 15${NBSP}000 теңге.`,
    );
  });

  it("gives a Russian client the Russian text", () => {
    const russian = { ...CONTACT, messageLocale: "ru" as const };
    expect(textOf(buildReminderLink(russian, "before_7", CONTEXT, TODAY))).toBe(
      `Здравствуйте, Әлихан! До 16${NBSP}января, 15${NBSP}000 тенге.`,
    );
  });

  it("falls back to the Russian text, with a Russian date, when the language has none", () => {
    expect(textOf(buildReminderLink(CONTACT, "overdue", CONTEXT, TODAY))).toBe(
      `Әлихан, абонемент закончился 16${NBSP}января.`,
    );
  });

  it("gives no link without a template of the kind", () => {
    expect(buildReminderLink(CONTACT, "before_1", CONTEXT, TODAY)).toBeNull();
  });
});
