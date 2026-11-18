import { describe, expect, it } from "vitest";

import {
  type FamilyMember,
  familyOf,
  parseRemindersOverdue,
  parseRemindersToday,
  type ReminderContext,
} from "./service";

// Step 22: one message per parent on the Reminders tabs, built the same way as on Today (D-18).

const NOW = new Date("2026-03-15T06:00:00Z");
const PARENT = "3f1c2a7e-0000-4000-8000-0000000000aa";

const CONTEXT: ReminderContext = {
  gymName: "Зал",
  reminderDays: [7, 1],
  templates: (["ru", "kk", "uz"] as const).flatMap((locale) => [
    {
      id: `family-${locale}`,
      kind: "family" as const,
      locale,
      body: `${locale}: {имя}, {дети}`,
      edited: true,
    },
    {
      id: `overdue-${locale}`,
      kind: "overdue" as const,
      locale,
      body: `${locale}: {имя}, {дата_окончания}`,
      edited: true,
    },
    {
      id: `before_7-${locale}`,
      kind: "before_7" as const,
      locale,
      body: `${locale}: {имя}, {дата_окончания}`,
      edited: true,
    },
  ]),
};

const RAW_CONTEXT = {
  gym_name: CONTEXT.gymName,
  reminder_days: CONTEXT.reminderDays,
  templates: CONTEXT.templates,
};

function member(
  firstName: string,
  parentId: string | null = PARENT,
): FamilyMember {
  return {
    paymentId: `payment-${firstName}`,
    kind: "overdue",
    firstName,
    endsOn: "2026-03-10",
    price: 15000,
    phone: "+77031234567",
    parentId,
    parentName: parentId === null ? null : "Айгуль",
    messageLocale: "kk",
  };
}

/** A row of reminders_screen() for one client. */
function contact(
  id: string,
  firstName: string,
  parentId: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    last_name: "Семейный",
    first_name: firstName,
    phone: parentId === null ? "+77010000001" : "+77031234567",
    parent_id: parentId,
    parent_name: parentId === null ? null : "Айгуль",
    message_locale: "ru",
    group_name: null,
    price: 15000,
    payment_id: `payment-${id}`,
    kind: null,
    ends_on: "2026-03-10",
    ...extra,
  };
}

describe("familyOf", () => {
  it("two children of one parent: one message to the parent's phone, in the parent's language", () => {
    const family = familyOf([member("Арман"), member("Дана")], CONTEXT, NOW);
    expect(family?.parent).toEqual({ id: PARENT, name: "Айгуль" });
    expect(family?.firstNames).toEqual(["Арман", "Дана"]);
    expect(family?.target).toEqual({
      parentId: PARENT,
      items: [
        { paymentId: "payment-Арман", kind: "overdue" },
        { paymentId: "payment-Дана", kind: "overdue" },
      ],
    });
    expect(family?.message?.defaultLocale).toBe("kk");
    const href = family?.message?.variants.kk.href ?? "";
    expect(href).toMatch(/^https:\/\/wa\.me\/77031234567\?text=/);
    const text = new URL(href).searchParams.get("text") ?? "";
    expect(text).toContain("Айгуль");
    expect(text).toContain("Арман");
    expect(text).toContain("Дана");
  });

  it("a single child and an adult get no family message", () => {
    expect(familyOf([member("Арман")], CONTEXT, NOW)).toBeNull();
    expect(familyOf([member("А", null)], CONTEXT, NOW)).toBeNull();
    expect(familyOf([], CONTEXT, NOW)).toBeNull();
  });
});

describe("parseRemindersOverdue", () => {
  it("puts a parent's overdue children in one block at the place of the first", () => {
    const data = parseRemindersOverdue(
      {
        context: RAW_CONTEXT,
        overdue: [
          contact("a", "Арман", PARENT, { event: null }),
          contact("b", "Болат", null, { event: null }),
          contact("c", "Дана", PARENT, { event: null }),
        ],
      },
      NOW,
    );
    expect(data.rows).toBe(3);
    expect(
      data.overdue.map((block) => block.items.map((item) => item.clientId)),
    ).toEqual([["a", "c"], ["b"]]);
    expect(data.overdue[0]?.family?.firstNames).toEqual(["Арман", "Дана"]);
    expect(data.overdue[1]?.family).toBeNull();
    // The adult keeps a link of their own.
    expect(data.overdue[1]?.items[0]?.href).toMatch(/^https:\/\/wa\.me\//);
  });
});

describe("parseRemindersToday", () => {
  const event = (id: string, clientId: string, parentId: string | null) => ({
    id,
    client_id: clientId,
    payment_id: `payment-${clientId}`,
    kind: "before_7",
    status: "chat_opened",
    opened_at: "2026-03-15T05:00:00Z",
    opened_by_name: "Админ",
    marked_sent_at: null,
    marked_sent_by_name: null,
    last_name: "Семейный",
    first_name: clientId,
    parent_id: parentId,
    parent_name: parentId === null ? null : "Айгуль",
  });

  it("due rows of one parent make one block; opened chats of one parent too", () => {
    const data = parseRemindersToday(
      {
        context: RAW_CONTEXT,
        due: [
          contact("a", "Арман", PARENT, { kind: "before_7" }),
          contact("c", "Дана", PARENT, { kind: "before_7" }),
        ],
        opened: [
          event("e1", "x", PARENT),
          event("e2", "y", null),
          event("e3", "z", PARENT),
          event("e4", "w", "3f1c2a7e-0000-4000-8000-0000000000bb"),
        ],
      },
      NOW,
    );
    expect(data.due).toHaveLength(1);
    expect(data.due[0]?.family?.target.items).toHaveLength(2);
    expect(
      data.opened.map((block) => ({
        parent: block.parent?.id ?? null,
        events: block.events.map((e) => e.id),
      })),
    ).toEqual([
      { parent: PARENT, events: ["e1", "e3"] },
      { parent: null, events: ["e2"] },
      // A single child of a parent is a plain row: there is nothing to mark together.
      { parent: null, events: ["e4"] },
    ]);
  });
});
