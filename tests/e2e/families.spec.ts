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
      await save(page);
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
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
