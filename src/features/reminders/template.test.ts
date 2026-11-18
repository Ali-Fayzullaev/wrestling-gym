import { describe, expect, it } from "vitest";

import {
  type FamilyChild,
  familyLine,
  familyValues,
  isDraftTemplate,
  pickTemplate,
  type ReminderContact,
  type ReminderTemplate,
  reminderValues,
  renderTemplate,
  type TemplateValues,
  unknownVariables,
} from "./template";

const NBSP = "\u00a0";
const TODAY = new Date("2026-11-14T06:00:00Z");

const VALUES: TemplateValues = {
  имя: "Азамат",
  дата_окончания: `15${NBSP}ноября`,
  сумма: `15${NBSP}000`,
  группа: "Дети 6–9 лет",
  название_зала: "Зал греко-римской борьбы",
  дети: null,
};

const ADULT: ReminderContact = {
  firstName: "Азамат",
  messageLocale: "ru",
  parentName: null,
  groupName: "Взрослые",
  price: 20000,
  endsOn: "2026-11-15",
};

describe("renderTemplate", () => {
  it("fills every variable", () => {
    expect(
      renderTemplate(
        "Здравствуйте, {имя}! {название_зала}, группа «{группа}»: до {дата_окончания}, {сумма} тенге.",
        VALUES,
      ),
    ).toBe(
      `Здравствуйте, Азамат! Зал греко-римской борьбы, группа «Дети 6–9 лет»: до 15${NBSP}ноября, 15${NBSP}000 тенге.`,
    );
  });

  it("fills a variable used twice", () => {
    expect(renderTemplate("{имя}, {имя}", VALUES)).toBe("Азамат, Азамат");
  });

  it("leaves an unknown variable exactly as written", () => {
    expect(
      renderTemplate("Привет, {имя}! {телефон} {Имя} { имя }", VALUES),
    ).toBe("Привет, Азамат! {телефон} {Имя} { имя }");
  });

  it("drops a missing amount without leaving double spaces or a space before punctuation", () => {
    const text = renderTemplate(
      "Сумма продления: {сумма} тенге. Группа {группа}, ждём!",
      {
        ...VALUES,
        сумма: null,
        группа: null,
      },
    );
    expect(text).toBe("Сумма продления: тенге. Группа, ждём!");
    expect(text).not.toMatch(/ {2}| [,.!?:;]|\{/);
  });

  it("keeps line breaks, trims each line and squeezes blank lines", () => {
    expect(
      renderTemplate(
        "  {имя},\r\n\r\n\r\n\r\n  до   {дата_окончания}  ",
        VALUES,
      ),
    ).toBe(`Азамат,\n\nдо 15${NBSP}ноября`);
  });
});

describe("unknownVariables", () => {
  it("lists unknown tokens once, in order", () => {
    expect(unknownVariables("{имя} {телефон} {сумма} {телефон} {}")).toEqual([
      "{телефон}",
      "{}",
    ]);
  });

  it("is empty for a template with known variables only", () => {
    expect(
      unknownVariables(
        "{имя} {дата_окончания} {сумма} {группа} {название_зала}",
      ),
    ).toEqual([]);
  });
});

describe("reminderValues", () => {
  it("greets an adult by first name and formats the date and amount", () => {
    expect(reminderValues(ADULT, "Зал", TODAY, "ru")).toEqual({
      имя: "Азамат",
      дата_окончания: `15${NBSP}ноября`,
      сумма: `20${NBSP}000`,
      группа: "Взрослые",
      название_зала: "Зал",
      дети: null,
    });
  });

  it("greets the parent of a child: the message goes to the parent", () => {
    const child = { ...ADULT, parentName: "Динара" };
    expect(reminderValues(child, "Зал", TODAY, "ru").имя).toBe("Динара");
  });

  it("has no amount or group without a group", () => {
    const values = reminderValues(
      { ...ADULT, groupName: null, price: null },
      "Зал",
      TODAY,
      "ru",
    );
    expect(values.сумма).toBeNull();
    expect(values.группа).toBeNull();
  });

  it("adds the year to an end date in another year", () => {
    const values = reminderValues(
      { ...ADULT, endsOn: "2027-01-02" },
      "Зал",
      TODAY,
      "ru",
    );
    expect(values.дата_окончания).toBe(`2${NBSP}января${NBSP}2027${NBSP}г.`);
  });
});

const TEMPLATES: ReminderTemplate[] = [
  { id: "ru-7", kind: "before_7", locale: "ru", body: "ru", edited: false },
  { id: "kk-7", kind: "before_7", locale: "kk", body: "kk", edited: false },
  { id: "uz-7", kind: "before_7", locale: "uz", body: "uz", edited: true },
  { id: "ru-0", kind: "overdue", locale: "ru", body: "ru", edited: false },
];

describe("pickTemplate", () => {
  it("takes the template of the kind in the client's language", () => {
    expect(pickTemplate(TEMPLATES, "before_7", "kk")?.id).toBe("kk-7");
    expect(pickTemplate(TEMPLATES, "before_7", "uz")?.id).toBe("uz-7");
    expect(pickTemplate(TEMPLATES, "before_7", "ru")?.id).toBe("ru-7");
  });

  it("falls back to Russian when the language has no template of that kind", () => {
    expect(pickTemplate(TEMPLATES, "overdue", "kk")?.id).toBe("ru-0");
    expect(pickTemplate(TEMPLATES, "overdue", "uz")?.id).toBe("ru-0");
  });

  it("step 20: a language chosen for one message picks its template, Russian when it has none", () => {
    // The same function serves the card's language and the switch: only the language differs.
    expect(pickTemplate(TEMPLATES, "before_7", "uz")?.locale).toBe("uz");
    expect(pickTemplate(TEMPLATES, "overdue", "uz")?.locale).toBe("ru");
  });

  it("gives null without a template of that kind in any usable language", () => {
    expect(pickTemplate(TEMPLATES, "before_1", "kk")).toBeNull();
    const kazakhOnly = TEMPLATES.filter((t) => t.id === "kk-7");
    expect(pickTemplate(kazakhOnly, "before_7", "uz")).toBeNull();
  });
});

describe("isDraftTemplate", () => {
  it("marks an unedited Kazakh or Uzbek text only", () => {
    expect(TEMPLATES.filter(isDraftTemplate).map((t) => t.id)).toEqual([
      "kk-7",
    ]);
  });

  it("marks the unedited several-children texts in every language (D-18)", () => {
    const family: ReminderTemplate[] = [
      { id: "ru-f", kind: "family", locale: "ru", body: "ru", edited: false },
      { id: "kk-f", kind: "family", locale: "kk", body: "kk", edited: true },
    ];
    expect(family.filter(isDraftTemplate).map((t) => t.id)).toEqual(["ru-f"]);
  });
});

describe("a message about several children (D-18)", () => {
  const ARMAN: FamilyChild = {
    firstName: "Арман",
    endsOn: "2026-12-16",
    price: 15000,
  };
  const DANA: FamilyChild = {
    firstName: "Дана",
    endsOn: "2026-11-20",
    price: null,
  };

  it("writes one line per child: name, end date and price", () => {
    expect(familyLine(ARMAN, TODAY, "ru")).toBe(
      `Арман: до 16${NBSP}декабря, 15${NBSP}000 ₸`,
    );
  });

  it("leaves out a missing price or date", () => {
    expect(familyLine(DANA, TODAY, "ru")).toBe(`Дана: до 20${NBSP}ноября`);
    expect(
      familyLine({ firstName: "Ия", endsOn: null, price: null }, TODAY, "ru"),
    ).toBe("Ия");
  });

  it("writes the lines in the message's language", () => {
    expect(familyLine(ARMAN, TODAY, "kk")).toBe(
      `Арман: мерзімі 16${NBSP}желтоқсан, 15${NBSP}000 ₸`,
    );
    expect(familyLine(ARMAN, TODAY, "uz")).toMatch(/^Арман: муддати 16/);
  });

  it("greets the parent and lists every child on its own line", () => {
    const values = familyValues("Айгуль", [ARMAN, DANA], "Зал", TODAY, "ru");
    expect(values.имя).toBe("Айгуль");
    expect(
      renderTemplate(
        "Здравствуйте, {имя}! {название_зала}:\n{дети}\nЖдём!",
        values,
      ),
    ).toBe(
      `Здравствуйте, Айгуль! Зал:\nАрман: до 16${NBSP}декабря, 15${NBSP}000 ₸\nДана: до 20${NBSP}ноября\nЖдём!`,
    );
  });

  it("has no single date, amount or group for several children", () => {
    const values = familyValues("Айгуль", [ARMAN], "Зал", TODAY, "ru");
    expect([values.дата_окончания, values.сумма, values.группа]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("reminderValues in the template's language", () => {
  it("writes the month in Kazakh and Uzbek", () => {
    const january = { ...ADULT, endsOn: "2026-01-16" };
    const today = new Date("2026-01-10T06:00:00Z");
    expect(reminderValues(january, "Зал", today, "ru").дата_окончания).toBe(
      `16${NBSP}января`,
    );
    expect(reminderValues(january, "Зал", today, "kk").дата_окончания).toBe(
      `16${NBSP}қаңтар`,
    );
    expect(reminderValues(january, "Зал", today, "uz").дата_окончания).toBe(
      `16${NBSP}январ`,
    );
  });

  it("uses each language's word order with a year", () => {
    const next = { ...ADULT, endsOn: "2027-01-02" };
    expect(reminderValues(next, "Зал", TODAY, "kk").дата_окончания).toBe(
      `2027${NBSP}ж.${NBSP}2${NBSP}қаңтар`,
    );
    expect(reminderValues(next, "Зал", TODAY, "uz").дата_окончания).toBe(
      `2${NBSP}январ,${NBSP}2027`,
    );
  });

  it("groups the amount in every language and keeps the gym name as is", () => {
    for (const locale of ["ru", "kk", "uz"] as const) {
      const values = reminderValues(
        ADULT,
        "Зал греко-римской борьбы",
        TODAY,
        locale,
      );
      expect(values.сумма).toBe(`20${NBSP}000`);
      expect(values.название_зала).toBe("Зал греко-римской борьбы");
    }
  });
});
