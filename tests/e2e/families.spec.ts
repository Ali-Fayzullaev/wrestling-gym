import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { fmt } from "@/i18n/format";
import { ru } from "@/i18n/ru";
import { businessDate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";

import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

// Step 21 (D-18, D-19): a parent and several children.

const f = ru.clientForm;
const card = ru.clients.card;
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_OWNER = "00000000-0000-4000-8000-000000000001";
const SERVER_ROUND_TRIP = { timeout: 15_000 };

type Supabase = Parameters<typeof serviceClient>[0];

function unique(prefix: string): string {
  const letters = "абвгдежзиклмнопрстуф";
  const tail = Array.from(
    { length: 6 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join("");
  return `${prefix}${tail}`;
}

/** Fictional, outside the seed ranges. */
const randomPhone = () =>
  `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every URL the page requests or navigates to, to check for personal data. */
function recordUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("framenavigated", (frame) => urls.push(frame.url()));
  return urls;
}

function expectNoneIn(urls: string[], values: string[]) {
  const forms = values.flatMap((value) => [
    value,
    encodeURIComponent(value),
    value.replace(/^\+/, ""),
  ]);
  // The wa.me link carries the phone and the text by design (rule 3); nothing else may.
  for (const url of urls.filter((u) => !u.startsWith("https://wa.me/")))
    for (const value of forms) expect(url).not.toContain(value);
}

async function cleanUp(supabase: Supabase, lastName: string) {
  const db = serviceClient(supabase);
  const { data } = await db
    .from("clients")
    .select("id, parent_id")
    .eq("last_name", lastName);
  // No payments or consents: the children and then their parent can go.
  const parents = [...new Set((data ?? []).map((row) => row.parent_id))];
  await db.from("clients").delete().eq("last_name", lastName);
  for (const id of parents)
    if (id) await db.from("parents").delete().eq("id", id);
}

type SeededFamily = {
  parentId: string;
  childIds: string[];
  paymentIds: string[];
};

/**
 * A parent and children inserted directly, each with a payment ending on its own date (null: no
 * payment). Recorded a month ago, so no reminder of these subscriptions was opened yet.
 */
async function seedFamily(
  supabase: Supabase,
  family: {
    lastName: string;
    parentName: string;
    parentPhone: string;
    children: { firstName: string; periodEnd: string | null }[];
  },
): Promise<SeededFamily> {
  const db = serviceClient(supabase);
  const today = businessDate(new Date());
  const parentId = randomUUID();
  const childIds = family.children.map(() => randomUUID());
  const { error: parentError } = await db.from("parents").insert({
    id: parentId,
    name: family.parentName,
    phone: family.parentPhone,
    message_locale: "ru",
    created_by: SEED_OWNER,
  });
  if (parentError) throw new Error(`parent: ${parentError.code}`);
  if (childIds.length > 0) {
    const { error: childError } = await db.from("clients").insert(
      family.children.map((child, i) => ({
        id: childIds[i],
        last_name: family.lastName,
        first_name: child.firstName,
        parent_id: parentId,
        group_id: SEED_GROUP,
        started_on: addDays(today, -90),
        created_by: SEED_OWNER,
      })),
    );
    if (childError) throw new Error(`children: ${childError.code}`);
  }
  const paid = family.children.flatMap((child, i) =>
    child.periodEnd === null
      ? []
      : [{ clientId: childIds[i] ?? "", periodEnd: child.periodEnd }],
  );
  const paymentIds = paid.map(() => randomUUID());
  if (paid.length > 0) {
    const { error: paymentError } = await db.from("payments").insert(
      paid.map((payment, i) => ({
        id: paymentIds[i],
        client_id: payment.clientId,
        kind: "payment",
        amount: 15000,
        method: "cash",
        period_start: addDays(payment.periodEnd, -29),
        period_end: payment.periodEnd,
        idempotency_key: randomUUID(),
        created_by: SEED_OWNER,
        created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      })),
    );
    if (paymentError) throw new Error(`payments: ${paymentError.code}`);
  }
  return { parentId, childIds, paymentIds };
}

/** Events and payments are append-only: the children and the parent are archived and stay. */
async function archiveFamily(supabase: Supabase, family: SeededFamily) {
  const db = serviceClient(supabase);
  const now = new Date().toISOString();
  await db
    .from("clients")
    .update({ archived_at: now })
    .in("id", family.childIds);
  await db
    .from("parents")
    .update({ archived_at: now })
    .eq("id", family.parentId);
}

/** wa.me stays inside the test: the popup gets a stub page instead of WhatsApp. */
async function stubWhatsApp(page: Page) {
  await page
    .context()
    .route("https://wa.me/**", (route) =>
      route.fulfill({ contentType: "text/plain", body: "wa.me" }),
    );
}

const visible = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true });

async function fillChild(page: Page, lastName: string, firstName: string) {
  await page.getByLabel(f.kindChild).check();
  await page.getByLabel(f.lastName, { exact: true }).fill(lastName);
  await page.getByLabel(f.firstName, { exact: true }).fill(firstName);
  await page
    .locator("form")
    .getByLabel(f.group, { exact: true })
    .selectOption({ index: 1 });
}

const save = (page: Page) => page.getByRole("button", { name: f.save }).click();

test.describe("A parent and several children", () => {
  test("criterion 8: a child with a new parent, another child of that parent, a child of a found parent", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Семейный");
    const parentName = unique("Мама");
    const parentPhone = randomPhone();
    const urls = recordUrls(page);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);

      // 1. A child without a phone, with a new parent.
      await page.goto("/clients/new");
      await fillChild(page, lastName, "Арман");
      await save(page);
      // A child needs a parent.
      await expect(page.getByText(f.errors.parentId)).toBeVisible();
      await page.getByLabel(f.parentNew).check();
      await page.getByLabel(f.newParentName).fill(parentName);
      await page.getByLabel(f.newParentPhone).fill(parentPhone);
      await page.getByLabel(f.newParentLocale).selectOption("kk");
      // D-10: the child form has no consent marks; the parent choice is radios, not checkboxes.
      await expect(page.locator("form").getByRole("checkbox")).toHaveCount(0);
      await save(page);
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
      // ...and the child's card has no consents section.
      await expect(page.getByRole("main")).not.toContainText("Согласи");
      const parentBlock = page.getByTestId("client-parent");
      await expect(parentBlock).toContainText(parentName);
      await expect(parentBlock).toContainText(formatPhone(parentPhone));
      await expect(page.getByText(card.noPhone)).toBeVisible();

      // 2. "Another child of this parent": the parent is already chosen.
      await parentBlock.getByTestId("add-sibling").click();
      await expect(page).toHaveURL(/\/clients\/new\?parent=[0-9a-f-]{36}$/);
      await expect(page.getByTestId("parent-chosen")).toContainText(parentName);
      await page.getByLabel(f.lastName, { exact: true }).fill(lastName);
      await page.getByLabel(f.firstName, { exact: true }).fill("Дана");
      await save(page);
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId("client-parent")).toContainText(parentName);

      // 3. A child of a parent found by phone digits.
      await page.goto("/clients/new");
      await fillChild(page, lastName, "Тимур");
      await page.getByLabel(f.parentSearch).fill(parentPhone.slice(-7));
      const results = page.getByTestId("parent-results");
      await expect(results).toContainText(parentName);
      // The children already on file help to tell namesakes apart.
      await expect(results).toContainText(
        fmt(f.parentChildren, { names: "Арман, Дана" }),
      );
      await results.getByRole("button").first().click();
      await expect(page.getByTestId("parent-chosen")).toContainText(parentName);
      await save(page);
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);

      // The parent's card: phone and language once, every child with "Paid".
      await page
        .getByTestId("client-parent")
        .getByRole("link", { name: parentName })
        .click();
      await expect(page).toHaveURL(/\/parents\/[0-9a-f-]{36}$/);
      await expect(
        page.getByRole("heading", { level: 1, name: parentName }),
      ).toBeVisible();
      const children = page.getByTestId("parent-child");
      await expect(children).toHaveCount(3);
      await expect(children.getByTestId("pay-button")).toHaveCount(3);

      // The phone is stored once, on the parent.
      const { data } = await serviceClient(supabase)
        .from("clients")
        .select("phone, parent_id")
        .eq("last_name", lastName);
      expect(data?.map((row) => row.phone)).toEqual([null, null, null]);
      expect(new Set(data?.map((row) => row.parent_id)).size).toBe(1);

      // Criterion 7: no name or phone in any URL; ids only.
      expectNoneIn(urls, [lastName, parentName, parentPhone, "Арман"]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await cleanUp(supabase, lastName);
    }
  });

  test("criterion 4: one message to the parent about both children; chat opened for each of them", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Напоминаемый");
    const parentName = unique("Айгуль");
    const parentPhone = randomPhone();
    const db = serviceClient(supabase);
    const parentId = randomUUID();
    const today = businessDate(new Date());
    const periodEnd = addDays(today, 1);
    const childIds = [randomUUID(), randomUUID()];
    const paymentIds = [randomUUID(), randomUUID()];
    const { error: parentError } = await db.from("parents").insert({
      id: parentId,
      name: parentName,
      phone: parentPhone,
      message_locale: "ru",
      created_by: SEED_OWNER,
    });
    if (parentError) throw new Error(`parent: ${parentError.code}`);
    const { error: childError } = await db.from("clients").insert(
      ["Арман", "Дана"].map((firstName, i) => ({
        id: childIds[i],
        last_name: lastName,
        first_name: firstName,
        parent_id: parentId,
        group_id: SEED_GROUP,
        started_on: addDays(today, -60),
        created_by: SEED_OWNER,
      })),
    );
    if (childError) throw new Error(`children: ${childError.code}`);
    const { error: paymentError } = await db.from("payments").insert(
      childIds.map((clientId, i) => ({
        id: paymentIds[i],
        client_id: clientId,
        kind: "payment",
        amount: 15000,
        method: "cash",
        period_start: addDays(periodEnd, -29),
        period_end: periodEnd,
        idempotency_key: randomUUID(),
        created_by: SEED_OWNER,
        created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      })),
    );
    if (paymentError) throw new Error(`payments: ${paymentError.code}`);
    const urls = recordUrls(page);

    try {
      await page
        .context()
        .route("https://wa.me/**", (route) =>
          route.fulfill({ contentType: "text/plain", body: "wa.me" }),
        );
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await expect(page).toHaveURL("/today");

      const block = page
        .getByTestId("remind-family")
        .filter({ visible: true })
        .filter({ hasText: parentName });
      await expect(block).toHaveCount(1);
      await expect(block.getByTestId("remind-family-title")).toHaveText(
        fmt(ru.today.family, { parent: parentName, children: "Арман, Дана" }),
      );
      // "Paid" stays per child (D-19).
      await expect(block.getByTestId("remind-row")).toHaveCount(2);
      await expect(block.getByTestId("pay-button")).toHaveCount(2);

      const link = block.getByTestId("whatsapp-button");
      await expect(link).toHaveCount(1);
      const href = (await link.getAttribute("href")) ?? "";
      const url = new URL(href);
      expect(url.origin + url.pathname).toBe(
        `https://wa.me/${parentPhone.slice(1)}`,
      );
      const text = url.searchParams.get("text") ?? "";
      expect(text).toContain(`Здравствуйте, ${parentName}!`);
      expect(text).toMatch(/Арман: до .+, 15\s000 ₸/);
      expect(text).toMatch(/Дана: до .+, 15\s000 ₸/);
      expect(text).not.toMatch(/\{[^}]*\}/);

      // The step 20 switch works here too: the Kazakh family text.
      await block.getByRole("button", { name: "Қазақша" }).click();
      const kkText =
        new URL((await link.getAttribute("href")) ?? "").searchParams.get(
          "text",
        ) ?? "";
      expect(kkText).toContain(`Сәлеметсіз бе, ${parentName}!`);
      expect(kkText).toContain("Арман: мерзімі");

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        link.click(),
      ]);
      await popup.close();
      await expect(block.getByTestId("whatsapp-status")).toContainText(
        ru.reminders.chatOpened,
      );
      // Both children leave "Remind today" once the events are saved.
      await expect(block).toHaveCount(0, SERVER_ROUND_TRIP);

      const { data: events } = await db
        .from("reminder_events")
        .select("client_id, kind")
        .in("payment_id", paymentIds);
      expect(events?.map((event) => event.client_id).sort()).toEqual(
        [...childIds].sort(),
      );
      expect(events?.every((event) => event.kind === "before_1")).toBe(true);

      expectNoneIn(urls, [lastName, parentName, parentPhone]);
      expect(consoleErrors).toEqual([]);
    } finally {
      // Events and payments are append-only: the children are archived and stay.
      await db
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .in("id", childIds);
      await db
        .from("parents")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", parentId);
    }
  });
});

// Step 22: the family block on the Reminders screen, a parent's archive and deletion.

test.describe("Reminders: one block per parent", () => {
  test("criteria 1, 3, 4: Today tab, one message, chat opened and Sent for both children", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Напоминаемый");
    const parentName = unique("Айгуль");
    const parentPhone = randomPhone();
    const today = businessDate(new Date());
    const family = await seedFamily(supabase, {
      lastName,
      parentName,
      parentPhone,
      children: [
        { firstName: "Арман", periodEnd: addDays(today, 1) },
        { firstName: "Дана", periodEnd: addDays(today, 1) },
      ],
    });
    const db = serviceClient(supabase);
    const urls = recordUrls(page);
    try {
      await stubWhatsApp(page);
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto("/reminders");

      const block = visible(page, "due-family").filter({ hasText: parentName });
      await expect(block).toHaveCount(1);
      await expect(block.getByTestId("family-title")).toHaveText(
        fmt(ru.reminders.screen.family, {
          parent: parentName,
          children: "Арман, Дана",
        }),
      );
      await expect(block.getByTestId("family-child")).toHaveCount(2);
      // No separate row for either child.
      await expect(
        visible(page, "due-row").filter({ hasText: lastName }),
      ).toHaveCount(0);

      const link = block.getByTestId("whatsapp-button");
      await expect(link).toHaveCount(1);
      const url = new URL((await link.getAttribute("href")) ?? "");
      expect(url.origin + url.pathname).toBe(
        `https://wa.me/${parentPhone.slice(1)}`,
      );
      const text = url.searchParams.get("text") ?? "";
      expect(text).toMatch(/Арман: до .+, 15\s000 ₸/);
      expect(text).toMatch(/Дана: до .+, 15\s000 ₸/);

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        link.click(),
      ]);
      await popup.close();

      // Both children move to "Chats opened today", together.
      const opened = visible(page, "opened-family").filter({
        hasText: parentName,
      });
      await expect(opened).toHaveCount(1, SERVER_ROUND_TRIP);
      await expect(block).toHaveCount(0);
      await expect(opened.getByTestId("family-child")).toHaveCount(2);
      await opened
        .getByRole("button", { name: ru.reminders.screen.markFamily })
        .click();
      await expect(opened.getByTestId("mark-sent-button")).toHaveCount(
        0,
        SERVER_ROUND_TRIP,
      );

      const { data: events } = await db
        .from("reminder_events")
        .select("client_id, status")
        .in("payment_id", family.paymentIds);
      expect(events).toHaveLength(2);
      expect(events?.every((event) => event.status === "marked_sent")).toBe(
        true,
      );

      expectNoneIn(urls, [lastName, parentName, parentPhone]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archiveFamily(supabase, family);
    }
  });

  test("criterion 2: Overdue tab, one block for the overdue children only", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Просроченный");
    const parentName = unique("Гульнара");
    const today = businessDate(new Date());
    const family = await seedFamily(supabase, {
      lastName,
      parentName,
      parentPhone: randomPhone(),
      children: [
        { firstName: "Арман", periodEnd: addDays(today, -3) },
        { firstName: "Дана", periodEnd: addDays(today, -4) },
        { firstName: "Тимур", periodEnd: addDays(today, 7) },
      ],
    });
    const db = serviceClient(supabase);
    try {
      await stubWhatsApp(page);
      await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
      await page.goto("/reminders?tab=overdue");

      const block = visible(page, "overdue-family").filter({
        hasText: parentName,
      });
      await expect(block).toHaveCount(1);
      await expect(block.getByTestId("family-child")).toHaveCount(2);
      await expect(block).not.toContainText("Тимур");
      await expect(block).toContainText(ru.reminders.screen.notOpened);

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        block.getByTestId("whatsapp-button").click(),
      ]);
      await popup.close();
      const mark = block.getByRole("button", {
        name: ru.reminders.screen.markFamily,
      });
      await expect(mark).toBeVisible(SERVER_ROUND_TRIP);
      await mark.click();
      await expect(block.getByTestId("mark-sent-button")).toHaveCount(
        0,
        SERVER_ROUND_TRIP,
      );

      const { data: events } = await db
        .from("reminder_events")
        .select("kind, status")
        .in("payment_id", family.paymentIds);
      expect(events).toEqual([
        { kind: "overdue", status: "marked_sent" },
        { kind: "overdue", status: "marked_sent" },
      ]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archiveFamily(supabase, family);
    }
  });
});

test.describe("A parent's archive and deletion", () => {
  const p = ru.parents;

  test("criterion 8: admin archives and restores; no Delete; D-23 refusal while a child is in work", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Архивный");
    const parentName = unique("Сауле");
    const family = await seedFamily(supabase, {
      lastName,
      parentName,
      parentPhone: randomPhone(),
      children: [{ firstName: "Арман", periodEnd: null }],
    });
    const db = serviceClient(supabase);
    const urls = recordUrls(page);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto(`/parents/${family.parentId}`);
      await expect(page.getByTestId("parent-delete")).toHaveCount(0);

      // STUB(D-23): the child is still in work.
      await page.getByTestId("parent-archive").click();
      await page.getByTestId("parent-archive-confirm").click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        p.errors.has_active_children,
      );
      await page.getByRole("button", { name: ru.common.cancel }).click();

      await db
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .in("id", family.childIds);
      await page.reload();
      await page.getByTestId("parent-archive").click();
      await page.getByTestId("parent-archive-confirm").click();
      await expect(page.getByTestId("parent-archived")).toBeVisible(
        SERVER_ROUND_TRIP,
      );
      await expect(page.getByTestId("parent-archive")).toHaveText(p.restore);

      // The child's card says the parent is archived.
      await page.goto(`/clients/${family.childIds[0] ?? ""}`);
      await expect(page.getByTestId("client-parent-archived")).toContainText(
        ru.clients.card.parentArchived,
      );
      // STUB(D-23): the child cannot come back while the parent is archived.
      await page.getByRole("button", { name: ru.clients.restore }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: ru.clients.restoreDialog.confirm })
        .click();
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        ru.clients.errors.parent_archived,
      );
      await page.getByRole("button", { name: ru.common.cancel }).click();

      await page.goto(`/parents/${family.parentId}`);
      await page.getByTestId("parent-archive").click();
      await page.getByTestId("parent-archive-confirm").click();
      await expect(page.getByTestId("parent-archived")).toHaveCount(
        0,
        SERVER_ROUND_TRIP,
      );

      expectNoneIn(urls, [lastName, parentName]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await cleanUp(supabase, lastName);
    }
  });

  test("criterion 8: the owner deletes a parent without children; with a child it is refused", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Удаляемый");
    const lonely = unique("Лишняя");
    const busy = unique("Занятая");
    const empty = await seedFamily(supabase, {
      lastName,
      parentName: lonely,
      parentPhone: randomPhone(),
      children: [],
    });
    const withChild = await seedFamily(supabase, {
      lastName,
      parentName: busy,
      parentPhone: randomPhone(),
      children: [{ firstName: "Дана", periodEnd: null }],
    });
    const db = serviceClient(supabase);
    const urls = recordUrls(page);
    const remove = async (name: string) => {
      await page.getByTestId("parent-delete").click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel(p.deleteDialog.reason)
        .selectOption("created_by_mistake");
      await dialog
        .getByLabel(fmt(p.deleteDialog.confirmLabel, { name }))
        .fill(name);
      await page.getByTestId("parent-delete-confirm").click();
    };
    try {
      await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);

      await page.goto(`/parents/${withChild.parentId}`);
      await remove(busy);
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        p.errors.has_children,
      );

      await page.goto(`/parents/${empty.parentId}`);
      await remove(lonely);
      await expect(page).toHaveURL("/clients", SERVER_ROUND_TRIP);
      await expect(page.getByText(p.deleteDialog.deleted)).toBeVisible();
      const { data } = await db
        .from("parents")
        .select("id")
        .eq("id", empty.parentId);
      expect(data).toEqual([]);

      expectNoneIn(urls, [lastName, lonely, busy]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await cleanUp(supabase, lastName);
      await db.from("parents").delete().eq("id", empty.parentId);
    }
  });
});

test.describe("Several children in one form (D-24)", () => {
  const block = (page: Page, number: number) =>
    page.getByRole("group", {
      name: fmt(f.childNumber, { number: String(number) }),
    });
  const addChild = (page: Page) =>
    page.getByRole("button", { name: f.addChild }).click();

  test("criteria 1, 3, 8: a new parent and three children; an error in one saves nobody", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Многодетный");
    const parentName = unique("Мама");
    const parentPhone = randomPhone();
    const urls = recordUrls(page);
    const db = serviceClient(supabase);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto("/clients/new");
      await page.getByLabel(f.kindChild).check();
      await page.getByLabel(f.parentNew).check();
      await page.getByLabel(f.newParentName).fill(parentName);
      await page.getByLabel(f.newParentPhone).fill(parentPhone);

      const first = block(page, 1);
      await first.getByLabel(f.lastName, { exact: true }).fill(lastName);
      await first.getByLabel(f.firstName, { exact: true }).fill("Арман");
      await first
        .getByLabel(f.group, { exact: true })
        .selectOption({ index: 1 });
      const group = await first
        .getByLabel(f.group, { exact: true })
        .inputValue();
      await first.getByLabel(f.startedOn).fill("2026-09-01");
      // The first child cannot be removed.
      await expect(
        first.getByRole("button", { name: f.removeChild }),
      ).toHaveCount(0);

      // Criterion 8: the new block copies last name, group and start date; the name is empty and
      // takes the focus.
      await addChild(page);
      const second = block(page, 2);
      await expect(second.getByLabel(f.lastName, { exact: true })).toHaveValue(
        lastName,
      );
      await expect(second.getByLabel(f.group, { exact: true })).toHaveValue(
        group,
      );
      await expect(second.getByLabel(f.startedOn)).toHaveValue("2026-09-01");
      await expect(second.getByLabel(f.firstName, { exact: true })).toHaveValue(
        "",
      );
      await expect(
        second.getByLabel(f.firstName, { exact: true }),
      ).toBeFocused();
      await page.keyboard.type("Дана");

      // A third block, removed, then added again.
      await addChild(page);
      await block(page, 3)
        .getByRole("button", {
          name: fmt(f.removeChildLabel, { number: "3" }),
        })
        .click();
      await expect(page.getByTestId("child-block")).toHaveCount(2);
      await expect(
        page.getByRole("button", { name: f.addChild }),
      ).toBeFocused();
      await addChild(page);
      await expect(page.getByTestId("child-block")).toHaveCount(3);

      // Criterion 3: the third child has no first name. Nobody is saved, the error is at that
      // field, and the focus is on it.
      await page.getByRole("button", { name: f.save }).click();
      const third = block(page, 3);
      await expect(third.getByText(f.errors.firstName)).toBeVisible();
      await expect(page.getByText(f.errors.firstName)).toHaveCount(1);
      await expect(
        third.getByLabel(f.firstName, { exact: true }),
      ).toBeFocused();
      const { data: noParent } = await db
        .from("parents")
        .select("id")
        .eq("phone", parentPhone);
      expect(noParent).toEqual([]);

      await third.getByLabel(f.firstName, { exact: true }).fill("Тимур");
      await page.getByRole("button", { name: f.save }).click();

      // Several children: the parent's card, each child with "Paid" (D-19).
      await expect(page).toHaveURL(
        /\/parents\/[0-9a-f-]{36}$/,
        SERVER_ROUND_TRIP,
      );
      await expect(
        page.getByRole("heading", { level: 1, name: parentName }),
      ).toBeVisible();
      const children = page.getByTestId("parent-child");
      await expect(children).toHaveCount(3);
      await expect(children.getByTestId("pay-button")).toHaveCount(3);

      const { data } = await db
        .from("clients")
        .select("first_name, parent_id, group_id, started_on")
        .eq("last_name", lastName)
        .order("request_position");
      expect(data?.map((row) => row.first_name)).toEqual([
        "Арман",
        "Дана",
        "Тимур",
      ]);
      expect(new Set(data?.map((row) => row.parent_id)).size).toBe(1);
      expect(new Set(data?.map((row) => row.group_id))).toEqual(
        new Set([group]),
      );
      expect(new Set(data?.map((row) => row.started_on))).toEqual(
        new Set(["2026-09-01"]),
      );
      const { data: parents } = await db
        .from("parents")
        .select("id")
        .eq("phone", parentPhone);
      expect(parents).toHaveLength(1);

      // Criterion 10: ids only in URLs.
      expectNoneIn(urls, [lastName, parentName, parentPhone, "Арман", "Тимур"]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await cleanUp(supabase, lastName);
    }
  });

  test("criterion 2: a parent on file and two children through ?parent=<id>", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = unique("Многодетный");
    const parentName = unique("Мама");
    const family = await seedFamily(supabase, {
      lastName,
      parentName,
      parentPhone: randomPhone(),
      children: [],
    });
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto(`/parents/${family.parentId}`);
      await page.getByRole("link", { name: ru.parents.addChild }).click();
      await expect(page).toHaveURL(/\/clients\/new\?parent=[0-9a-f-]{36}$/);
      await expect(page.getByTestId("parent-chosen")).toContainText(parentName);

      await block(page, 1)
        .getByLabel(f.lastName, { exact: true })
        .fill(lastName);
      await block(page, 1)
        .getByLabel(f.firstName, { exact: true })
        .fill("Алия");
      await addChild(page);
      await page.keyboard.type("Ержан");
      await page.getByRole("button", { name: f.save }).click();

      await expect(page).toHaveURL(
        `/parents/${family.parentId}`,
        SERVER_ROUND_TRIP,
      );
      await expect(page.getByTestId("parent-child")).toHaveCount(2);
      expect(consoleErrors).toEqual([]);
    } finally {
      await cleanUp(supabase, lastName);
      await serviceClient(supabase)
        .from("parents")
        .delete()
        .eq("id", family.parentId);
    }
  });

  test("criterion 8: after the tenth child the button is gone", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/clients/new");
    await page.getByLabel(f.kindChild).check();
    for (let i = 1; i < 10; i++) await addChild(page);
    await expect(page.getByTestId("child-block")).toHaveCount(10);
    await expect(page.getByRole("button", { name: f.addChild })).toHaveCount(0);
    await expect(
      page.getByText(fmt(f.childrenMax, { max: "10" })),
    ).toBeVisible();
    // Removing one brings it back, with the focus on it.
    await block(page, 10)
      .getByRole("button", { name: fmt(f.removeChildLabel, { number: "10" }) })
      .click();
    await expect(page.getByRole("button", { name: f.addChild })).toBeFocused();
  });
});
