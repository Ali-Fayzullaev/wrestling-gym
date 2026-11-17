import { describe, expect, it } from "vitest";

import {
  buildReminderLink,
  buildReminderMessage,
  type ReminderContext,
} from "./service";

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

describe("buildReminderMessage (step 20, D-17)", () => {
  const message = buildReminderMessage(CONTACT, "before_7", CONTEXT, TODAY);

  it("picks the client's language first", () => {
    expect(message?.defaultLocale).toBe("kk");
  });

  it("has a text and a matching link in each language, each in its own words", () => {
    expect(message?.variants.kk).toEqual({
      locale: "kk",
      draft: false,
      text: `Сәлеметсіз бе, Әлихан! Зал греко-римской борьбы: 16${NBSP}қаңтар, 15${NBSP}000 теңге.`,
      href: buildReminderLink(CONTACT, "before_7", CONTEXT, TODAY),
    });
    expect(message?.variants.ru).toMatchObject({
      locale: "ru",
      draft: false,
      text: `Здравствуйте, Әлихан! До 16${NBSP}января, 15${NBSP}000 тенге.`,
    });
    for (const variant of Object.values(message?.variants ?? {})) {
      expect(textOf(variant.href)).toBe(variant.text);
      expect(variant.href.startsWith("https://wa.me/77011234567?")).toBe(true);
    }
  });

  it("a language without a text says the Russian one goes out instead", () => {
    // No Uzbek template here: the Uzbek choice sends the Russian text and is named Russian.
    expect(message?.variants.uz).toEqual({ ...message?.variants.ru });
  });

  it("marks an unedited translation as a draft", () => {
    const draft = buildReminderMessage(
      CONTACT,
      "before_7",
      {
        ...CONTEXT,
        templates: CONTEXT.templates.map((template) => ({
          ...template,
          edited: false,
        })),
      },
      TODAY,
    );
    expect(draft?.variants.kk.draft).toBe(true);
    expect(draft?.variants.ru.draft).toBe(false);
  });

  it("is null without a template of the kind", () => {
    expect(
      buildReminderMessage(CONTACT, "before_1", CONTEXT, TODAY),
    ).toBeNull();
  });
});
