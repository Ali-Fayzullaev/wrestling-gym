import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { clientsText } from "@/i18n/clients";
import { paymentsText } from "@/i18n/payments";
import { ru } from "@/i18n/ru";

import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

const t = paymentsText;
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_ADMIN = "00000000-0000-4000-8000-000000000002";

type Supabase = Parameters<typeof serviceClient>[0];

/** Unique Cyrillic surname: letters only, so search treats it as one word. */
function surname(prefix: string): string {
  const letters = "абвгдежзиклмнопрстуф";
  const tail = Array.from(
    { length: 6 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join("");
  return `${prefix}${tail}`;
}

/**
 * A throwaway client without payments. Payments cannot be deleted, so afterwards the client is
 * archived (archive()) rather than removed: it leaves the default list and the counters.
 */
async function newClient(supabase: Supabase, lastName: string) {
  const id = randomUUID();
  const phone = `+7700${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { error } = await serviceClient(supabase).from("clients").insert({
    id,
    last_name: lastName,
    first_name: "Оплатов",
    phone,
    phone_owner: "self",
    group_id: SEED_GROUP,
    started_on: "2026-11-01",
    created_by: "00000000-0000-4000-8000-000000000001",
  });
  if (error) throw new Error(`client insert failed: ${error.code}`);
  return id;
}

async function archive(supabase: Supabase, id: string) {
  await serviceClient(supabase)
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
}

async function paymentsOf(supabase: Supabase, clientId: string) {
  const { data, error } = await serviceClient(supabase)
    .from("payments")
    .select("kind, amount, reason")
    .eq("client_id", clientId);
  if (error) throw new Error(`payments read failed: ${error.code}`);
  return data;
}

async function openList(page: Page, lastName: string): Promise<Locator> {
  await page.goto("/clients");
  await page
    .getByRole("searchbox", { name: clientsText.list.search })
    .fill(lastName);
  const row = page.getByTestId("client-row").filter({ hasText: lastName });
  await expect(row).toHaveCount(1);
  return row;
}

const rowStatus = (row: Locator) =>
  row.locator("[data-slot=status-badge]").filter({ visible: true });

function dialog(page: Page) {
  return page.getByRole("dialog").filter({ visible: true });
}

/** Server Actions are POSTs carrying a Next-Action header. */
const isAction = (method: string, headers: Record<string, string>) =>
  method === "POST" && "next-action" in headers;

test.describe("payment from the clients list", () => {
  test("criterion 8: two taps from the list to a saved payment, the row turns active", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Оплата");
    const clientId = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = await openList(page, lastName);
      await expect(rowStatus(row)).toHaveText(ru.status.none);

      let taps = 0;
      await row.getByTestId("row-pay").click();
      taps += 1;
      const form = dialog(page);
      await expect(form.getByLabel(t.dialog.amount)).toHaveValue(/^\d+$/);
      await expect(form.getByTestId("payment-preview")).toContainText("до");
      await form.getByTestId("payment-confirm").click();
      taps += 1;

      expect(taps).toBeLessThanOrEqual(3);
      await expect(rowStatus(row)).toHaveText(ru.status.active);
      await expect(page.getByText(/Оплата сохранена/)).toBeVisible();
      await expect
        .poll(() => paymentsOf(supabase, clientId))
        .toEqual([expect.objectContaining({ kind: "payment" })]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, clientId);
    }
  });

  test("criterion 9: a double click on Confirm records one payment", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Двойной");
    const clientId = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = await openList(page, lastName);
      await row.getByTestId("row-pay").click();
      await dialog(page).getByTestId("payment-confirm").dblclick();
      await expect(rowStatus(row)).toHaveText(ru.status.active);
      // The row turns active optimistically; leave only after the server has saved the payment,
      // otherwise the navigation can cut the Server Action short.
      await expect(page.getByText(/Оплата сохранена/)).toBeVisible();

      await page.goto(`/clients/${clientId}`);
      await expect(page.getByTestId("payment-entry")).toHaveCount(1);
      expect(await paymentsOf(supabase, clientId)).toHaveLength(1);
    } finally {
      await archive(supabase, clientId);
    }
  });

  test("criterion 10: a lost connection rolls the row back and says so", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Связь");
    const clientId = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = await openList(page, lastName);
      await page.route("**/clients**", async (route) => {
        const request = route.request();
        if (!isAction(request.method(), request.headers()))
          return route.continue();
        // Long enough to see the optimistic status, then the connection drops.
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.abort("internetdisconnected");
      });
      await row.getByTestId("row-pay").click();
      await dialog(page).getByTestId("payment-confirm").click();

      await expect(rowStatus(row)).toHaveText(ru.status.active);
      await expect(page.getByText(t.network)).toBeVisible();
      await expect(rowStatus(row)).toHaveText(ru.status.none);
      expect(await paymentsOf(supabase, clientId)).toEqual([]);
    } finally {
      await archive(supabase, clientId);
    }
  });

  test("Cancel in the toast reverses the payment right away", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Отмена");
    const clientId = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = await openList(page, lastName);
      await row.getByTestId("row-pay").click();
      await dialog(page).getByTestId("payment-confirm").click();
      await expect(rowStatus(row)).toHaveText(ru.status.active);

      await page.getByRole("button", { name: t.undo }).click();
      await expect(page.getByText(t.cancelled)).toBeVisible();
      await expect(rowStatus(row)).toHaveText(ru.status.none);
      await expect
        .poll(async () =>
          (await paymentsOf(supabase, clientId)).map((p) => p.kind).sort(),
        )
        .toEqual(["payment", "reversal"]);
    } finally {
      await archive(supabase, clientId);
    }
  });

  test("an invalid amount is caught next to the field and nothing is sent", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Сумма");
    const clientId = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = await openList(page, lastName);
      await row.getByTestId("row-pay").click();
      const form = dialog(page);
      const amount = form.getByLabel(t.dialog.amount);
      await amount.fill("0");
      await form.getByTestId("payment-confirm").click();
      await expect(amount).toHaveAttribute("aria-invalid", "true");
      await expect(form.getByText(t.dialog.amountError)).toBeVisible();
      expect(await paymentsOf(supabase, clientId)).toEqual([]);
    } finally {
      await archive(supabase, clientId);
    }
  });
});

test.describe("payment history on the card", () => {
  test("the owner's card with all four actions has no horizontal scroll", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.goto("/clients/20000000-0000-4000-8000-000000000001");
    await expect(page.getByTestId("pay-button")).toBeVisible();
    await expect(page.getByTestId("payment-entry").first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the admin pays from the card and may cancel their own payment", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Карточка");
    const clientId = await newClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto(`/clients/${clientId}`);
      await expect(page.getByText(t.history.emptyTitle)).toBeVisible();

      await page.getByTestId("pay-button").click();
      await dialog(page).getByTestId("payment-confirm").click();
      const entry = page.getByTestId("payment-entry");
      await expect(entry).toHaveCount(1);
      await expect(entry).toContainText(t.dialog.methods.cash);
      // An admin never sees the owner's reversal.
      await expect(entry.getByTestId("payment-reverse")).toHaveCount(0);

      await entry.getByTestId("payment-cancel").click();
      await dialog(page).getByTestId("reversal-confirm").click();
      await expect(entry.getByTestId("payment-reversal")).toContainText(
        "Отменено сразу",
      );
      await expect(entry.getByTestId("payment-cancel")).toHaveCount(0);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, clientId);
    }
  });

  test("the owner reverses an older payment with a required reason", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Сторно");
    const clientId = await newClient(supabase, lastName);
    try {
      // An admin's payment from earlier: no one-tap cancel any more, only the owner's reversal.
      const { error } = await serviceClient(supabase)
        .from("payments")
        .insert({
          client_id: clientId,
          kind: "payment",
          amount: 15000,
          method: "kaspi",
          period_start: "2026-10-20",
          period_end: "2026-11-19",
          idempotency_key: randomUUID(),
          created_by: SEED_ADMIN,
          created_at: new Date(Date.now() - 3_600_000).toISOString(),
        });
      if (error) throw new Error(`payment insert failed: ${error.code}`);

      await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
      await page.goto(`/clients/${clientId}`);
      const entry = page.getByTestId("payment-entry");
      await expect(entry).toContainText(t.dialog.methods.kaspi);
      await expect(entry.getByTestId("payment-cancel")).toHaveCount(0);

      await entry.getByTestId("payment-reverse").click();
      const form = dialog(page);
      await form.getByTestId("reversal-confirm").click();
      await expect(form.getByText(t.reverseDialog.reasonError)).toBeVisible();
      await form
        .getByLabel(t.reverseDialog.reason)
        .fill("Отмечено не тому клиенту");
      await form.getByTestId("reversal-confirm").click();

      await expect(entry.getByTestId("payment-reversal")).toContainText(
        "Отмечено не тому клиенту",
      );
      await expect(page.getByText(ru.status.none).first()).toBeVisible();
      await expect(entry.getByTestId("payment-reverse")).toHaveCount(0);
    } finally {
      await archive(supabase, clientId);
    }
  });
});
