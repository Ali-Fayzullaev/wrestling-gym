import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { paymentsText } from "@/i18n/payments";
import { ru } from "@/i18n/ru";
import { todayText } from "@/i18n/today";
import { businessDate } from "@/lib/dates";

import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

const t = todayText;
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_OWNER = "00000000-0000-4000-8000-000000000001";

type Supabase = Parameters<typeof serviceClient>[0];

function surname(prefix: string): string {
  const letters = "абвгдежзиклмнопрстуф";
  const tail = Array.from(
    { length: 6 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join("");
  return `${prefix}${tail}`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A throwaway client whose subscription (paid a month ago) ends tomorrow: the "1 day before"
 * reminder is due today. Payments cannot be deleted, so afterwards the client is archived.
 */
async function clientEndingTomorrow(supabase: Supabase, lastName: string) {
  const db = serviceClient(supabase);
  const id = randomUUID();
  const today = businessDate(new Date());
  const { error } = await db.from("clients").insert({
    id,
    last_name: lastName,
    first_name: "Сегодняшний",
    phone: `+7700${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    phone_owner: "self",
    group_id: SEED_GROUP,
    started_on: addDays(today, -60),
    created_by: SEED_OWNER,
  });
  if (error) throw new Error(`client insert failed: ${error.code}`);
  const periodEnd = addDays(today, 1);
  const { error: paymentError } = await db.from("payments").insert({
    client_id: id,
    kind: "payment",
    amount: 15000,
    method: "cash",
    period_start: addDays(periodEnd, -29),
    period_end: periodEnd,
    idempotency_key: randomUUID(),
    created_by: SEED_OWNER,
    created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  });
  if (paymentError)
    throw new Error(`payment insert failed: ${paymentError.code}`);
  return id;
}

async function archive(supabase: Supabase, id: string) {
  await serviceClient(supabase)
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
}

/** A counter card; the list switch below has links with the same names. */
const counter = (page: Page, label: string): Locator =>
  page
    .getByRole("region", { name: t.counters.label })
    .getByRole("link", { name: new RegExp(label) });

async function counterValue(page: Page, label: string): Promise<number> {
  const text = await counter(page, label)
    .locator("span span")
    .first()
    .innerText();
  return Number(text);
}

const visibleRows = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true });

function dialog(page: Page) {
  return page.getByRole("dialog").filter({ visible: true });
}

test.describe("Today screen", () => {
  test("shows the date greeting, four counters and no console errors", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.today }),
    ).toBeVisible();
    // "Суббота, 14 ноября": weekday, day and month in Almaty.
    await expect(page.locator("header p").first()).toHaveText(
      /^[А-ЯЁ][а-яё]+, \d{1,2} [а-яё]+$/,
    );
    for (const label of [
      t.counters.remindToday,
      t.counters.debtors,
      t.counters.expiringWeek,
      t.counters.paidToday,
    ]) {
      await expect(counter(page, label)).toBeVisible();
    }
    expect(consoleErrors).toEqual([]);
  });

  // Other tests run in parallel and change the data, so each check retries as a whole: the counter
  // and the list it opens are read again until they come from the same moment.
  const cases = [
    {
      label: t.counters.debtors,
      url: /\/clients\?status=expired$/,
      rows: "client-row",
    },
    {
      label: t.counters.expiringWeek,
      url: /\/clients\?status=expiring$/,
      rows: "client-row",
    },
    { label: t.counters.remindToday, url: /\/today$/, rows: "remind-row" },
    {
      label: t.counters.paidToday,
      url: /\/today\?list=paid$/,
      rows: "paid-row",
    },
  ];

  for (const { label, url, rows } of cases) {
    test(`criterion 3: "${label}" opens its list with as many rows`, async ({
      page,
      consoleErrors,
    }) => {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await expect(async () => {
        await page.goto("/today");
        const expected = await counterValue(page, label);
        expect(expected).toBeGreaterThan(0);
        await counter(page, label).click();
        await expect(page).toHaveURL(url);
        await expect(visibleRows(page, rows)).toHaveCount(expected, {
          timeout: 3000,
        });
      }).toPass({ timeout: 30_000 });
      expect(consoleErrors).toEqual([]);
    });
  }

  test('criterion 4: "Paid" removes the client from the reminders and counts them as paid today', async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Сегодня");
    const clientId = await clientEndingTomorrow(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = visibleRows(page, "remind-row").filter({ hasText: lastName });
      await expect(row).toHaveCount(1);

      await row.getByRole("button", { name: paymentsText.pay }).click();
      const form = dialog(page);
      await expect(form.getByLabel(paymentsText.dialog.amount)).toHaveValue(
        "15000",
      );
      await form.getByTestId("payment-confirm").click();

      await expect(row).toHaveCount(0);
      await expect(page.getByText(/Оплата сохранена/)).toBeVisible();

      await expect(async () => {
        await page.goto("/today?list=paid");
        const paid = await counterValue(page, t.counters.paidToday);
        await expect(
          visibleRows(page, "paid-row").filter({ hasText: lastName }),
        ).toHaveCount(1, { timeout: 3000 });
        await expect(visibleRows(page, "paid-row")).toHaveCount(paid, {
          timeout: 3000,
        });
      }).toPass({ timeout: 30_000 });

      // A reload confirms it is the server's list, not only the optimistic one.
      await page.goto("/today");
      await expect(
        visibleRows(page, "remind-row").filter({ hasText: lastName }),
      ).toHaveCount(0);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, clientId);
    }
  });

  test("the list switch marks the open list", async ({ page }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    const lists = page.getByRole("navigation", { name: t.lists.label });
    await expect(
      lists.getByRole("link", { name: t.lists.remind }),
    ).toHaveAttribute("aria-current", "page");
    await lists.getByRole("link", { name: t.lists.paid }).click();
    await expect(page).toHaveURL(/\/today\?list=paid$/);
    await expect(
      lists.getByRole("link", { name: t.lists.paid }),
    ).toHaveAttribute("aria-current", "page");
  });
});
