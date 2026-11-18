import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { ru } from "@/i18n/ru";
import { businessDate } from "@/lib/dates";

import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

/*
 * Acceptance criteria 1-3 (docs/acceptance.md) as the administrator meets them: signed in, on
 * "Today", a phone in the hand. The stopwatch on the real phone is the acceptance itself; these
 * timings are the automatic floor under it, so a slow screen is caught before the customer sees it.
 */

const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_OWNER = "00000000-0000-4000-8000-000000000001";
const FIND_LIMIT_MS = 3_000;
const PAY_LIMIT_MS = 10_000;

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

function randomPhone(): string {
  return `+7700${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

/** A throwaway client; with endsOn it has a paid month ending that day. Archived afterwards. */
async function newClient(
  supabase: Supabase,
  lastName: string,
  endsOn?: string,
): Promise<{ id: string; phone: string }> {
  const db = serviceClient(supabase);
  const id = randomUUID();
  const phone = randomPhone();
  const today = businessDate(new Date());
  const { error } = await db.from("clients").insert({
    id,
    last_name: lastName,
    first_name: "Приёмка",
    phone,
    group_id: SEED_GROUP,
    started_on: addDays(today, -60),
    created_by: SEED_OWNER,
  });
  if (error) throw new Error(`client insert failed: ${error.code}`);
  if (endsOn) {
    const { error: paymentError } = await db.from("payments").insert({
      client_id: id,
      kind: "payment",
      amount: 15000,
      method: "cash",
      period_start: addDays(endsOn, -29),
      period_end: endsOn,
      idempotency_key: randomUUID(),
      created_by: SEED_OWNER,
      created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    if (paymentError)
      throw new Error(`payment insert failed: ${paymentError.code}`);
  }
  return { id, phone };
}

async function archive(supabase: Supabase, id: string) {
  await serviceClient(supabase)
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
}

/** Keeps the measured time in the report, for the table in docs/acceptance.md. */
function recordTime(started: number): number {
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "time", description: `${elapsed} ms` });
  return elapsed;
}

/** The menu item the employee can see: bottom menu on a phone, side menu on a computer. */
function menuLink(page: Page, name: string) {
  return page
    .getByRole("link", { name, exact: true })
    .filter({ visible: true });
}

/** From "Today": open the clients, type the surname, see exactly that client. */
async function findFromToday(page: Page, lastName: string) {
  await menuLink(page, ru.nav.clients).click();
  await page
    .getByRole("searchbox", { name: ru.clientsList.search })
    .pressSequentially(lastName.slice(0, 8));
  const row = page.getByTestId("client-row").filter({ hasText: lastName });
  await expect(row).toHaveCount(1, { timeout: FIND_LIMIT_MS });
  return row;
}

test.describe("acceptance on the administrator's phone", () => {
  // One at a time: a second timed scenario on the same server would be part of the measurement.
  test.describe.configure({ mode: "default" });

  test("criterion 1: a client is found from Today in under 3 seconds", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Поиск");
    const client = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const started = Date.now();
      await findFromToday(page, lastName);
      expect(recordTime(started)).toBeLessThan(FIND_LIMIT_MS);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, client.id);
    }
  });

  test("criterion 2: a payment is recorded from Today in under 10 seconds", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Оплата");
    const client = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const started = Date.now();
      const row = await findFromToday(page, lastName);
      await row.getByTestId("row-pay").click();
      await page
        .getByRole("dialog")
        .filter({ visible: true })
        .getByTestId("payment-confirm")
        .click();
      await expect(page.getByText(/Оплата сохранена/)).toBeVisible({
        timeout: PAY_LIMIT_MS,
      });
      expect(recordTime(started)).toBeLessThan(PAY_LIMIT_MS);

      // The screen said "saved": the payment is really in the database, exactly once.
      await expect
        .poll(async () => {
          const { data } = await serviceClient(supabase)
            .from("payments")
            .select("kind")
            .eq("client_id", client.id);
          return data;
        })
        .toEqual([{ kind: "payment" }]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, client.id);
    }
  });

  test("criterion 3: one tap on Today opens WhatsApp with the ready text; the second tap is Send in WhatsApp", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Напомнить");
    const tomorrow = addDays(businessDate(new Date()), 1);
    const client = await newClient(supabase, lastName, tomorrow);
    try {
      await page
        .context()
        .route("https://wa.me/**", (route) =>
          route.fulfill({ contentType: "text/plain", body: "wa.me" }),
        );
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = page
        .getByTestId("remind-row")
        .filter({ visible: true })
        .filter({ hasText: lastName });
      await expect(row).toHaveCount(1);

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        row.getByTestId("whatsapp-button").click(),
      ]);
      const url = new URL(popup.url());
      expect(url.origin + url.pathname).toBe(
        `https://wa.me/${client.phone.slice(1)}`,
      );
      const text = url.searchParams.get("text") ?? "";
      expect(text).toContain("Приёмка");
      expect(text).not.toMatch(/\{[^}]*\}/);
      await popup.close();

      // Opening the chat is not sending: the row says so and nothing claims delivery.
      await expect(row.getByTestId("whatsapp-status")).toHaveText(
        new RegExp(`^${ru.reminders.chatOpened}`),
      );
      await expect(page.locator("body")).not.toHaveText(
        /отправлено|доставлено/i,
      );
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, client.id);
    }
  });
});
