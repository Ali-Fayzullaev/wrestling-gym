import { randomUUID } from "node:crypto";

import type { Locator, Page, Route } from "@playwright/test";

import { fmt } from "@/i18n/format";
import { ru } from "@/i18n/ru";
import { businessDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { LOCALE_NAMES } from "@/lib/locale";

import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

const remindersText = ru.reminders;
const todayText = ru.today;

const r = remindersText;
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_OWNER = "00000000-0000-4000-8000-000000000001";
// Nothing in the interface may claim a WhatsApp message went out before the manual mark.
const SENT_WORDS = /отправлено|доставлено/i;
// Waits for a Server Action's answer and the re-rendered screen, not for the browser alone.
const SERVER_ROUND_TRIP = { timeout: 15_000 };

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
 * A throwaway child whose subscription ends tomorrow (the "1 day before" reminder is due today);
 * the phone is a parent's. Events and payments cannot be deleted, so afterwards it is archived.
 */
async function childEndingTomorrow(supabase: Supabase, lastName: string) {
  const db = serviceClient(supabase);
  const id = randomUUID();
  const phone = `+7700${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const today = businessDate(new Date());
  const { error } = await db.from("clients").insert({
    id,
    last_name: lastName,
    first_name: "Ребёнок",
    phone,
    phone_owner: "parent",
    parent_name: "Гульнара",
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
  return { id, phone, periodEnd };
}

async function archive(supabase: Supabase, id: string) {
  await serviceClient(supabase)
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
}

const visibleRows = (page: Page, testId: string) =>
  page.getByTestId(testId).filter({ visible: true });

/** A menu or header link visible at this width (the phone and desktop menus differ). */
const menuLink = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true }).filter({ visible: true });

/**
 * Holds the "chat opened" Server Action of the page until released, so the row's state between
 * the click and the server's answer can be checked. The wa.me page itself is never loaded.
 */
async function holdReminderAction(page: Page, path: string) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${path}`, async (route: Route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      await released;
    }
    await route.continue();
  });
  return release;
}

async function stubWhatsApp(page: Page) {
  await page
    .context()
    .route("https://wa.me/**", (route) =>
      route.fulfill({ contentType: "text/plain", body: "wa.me" }),
    );
}

async function openChat(row: Locator, page: Page) {
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    row.getByTestId("whatsapp-button").click(),
  ]);
  return popup;
}

async function expectNoSentWords(page: Page) {
  await expect(page.locator("body")).not.toHaveText(SENT_WORDS);
}

test.describe("Reminders through wa.me", () => {
  test("criterion 6: WhatsApp opens wa.me with the text, the row says the chat is open, then leaves Today", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Ватсап");
    const client = await childEndingTomorrow(supabase, lastName);
    try {
      await stubWhatsApp(page);
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const row = visibleRows(page, "remind-row").filter({ hasText: lastName });
      await expect(row).toHaveCount(1);

      const link = row.getByTestId("whatsapp-button");
      const href = (await link.getAttribute("href")) ?? "";
      const url = new URL(href);
      expect(url.origin + url.pathname).toBe(
        `https://wa.me/${client.phone.slice(1)}`,
      );
      const text = url.searchParams.get("text") ?? "";
      // The parent is greeted; date, price and gym name are filled in; no variable is left.
      expect(text).toContain("Здравствуйте, Гульнара!");
      expect(text).toContain(formatDate(client.periodEnd, new Date(), "ru"));
      expect(text).toContain("15 000");
      expect(text).toContain(ru.app.name);
      expect(text).not.toMatch(/\{[^}]*\}/);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);

      const release = await holdReminderAction(page, "/today");
      const popup = await openChat(row, page);
      expect(popup.url()).toBe(href);
      await popup.close();

      await expect(row.getByTestId("whatsapp-status")).toHaveText(
        new RegExp(`^${r.chatOpened} \\d{2}:\\d{2}$`),
      );
      await expectNoSentWords(page);

      release();
      await expect(row).toHaveCount(0, SERVER_ROUND_TRIP);
      // The counter and the list come from the same reminders_due(): read again until both are
      // from one moment (parallel tests change the data).
      await expect(async () => {
        await page.goto("/today");
        const counter = page
          .getByRole("region", { name: todayText.counters.label })
          .getByRole("link", {
            name: new RegExp(todayText.counters.remindToday),
          })
          .locator("span span")
          .first();
        const value = Number(await counter.innerText());
        await expect(visibleRows(page, "remind-row")).toHaveCount(value, {
          timeout: 3000,
        });
        await expect(
          visibleRows(page, "remind-row").filter({ hasText: lastName }),
        ).toHaveCount(0);
      }).toPass({ timeout: 30_000 });

      const { data } = await serviceClient(supabase)
        .from("reminder_events")
        .select("kind, status")
        .eq("client_id", client.id);
      expect(data).toEqual([{ kind: "before_1", status: "chat_opened" }]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, client.id);
    }
  });

  test("criterion 7: no 'sent' or 'delivered' anywhere until the manual mark; the card shows the history", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const lastName = surname("Отметка");
    const client = await childEndingTomorrow(supabase, lastName);
    try {
      await stubWhatsApp(page);
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto("/reminders");
      await expect(
        page.getByText(r.screen.hint, { exact: true }),
      ).toBeVisible();
      await expectNoSentWords(page);

      const due = visibleRows(page, "due-row").filter({ hasText: lastName });
      await expect(due).toHaveCount(1);
      const popup = await openChat(due, page);
      await popup.close();

      // After the server's answer the client moves from "due" to "opened today".
      await expect(due).toHaveCount(0, SERVER_ROUND_TRIP);
      const opened = visibleRows(page, "event-row").filter({
        hasText: lastName,
      });
      await expect(opened).toContainText(r.chatOpened, SERVER_ROUND_TRIP);
      await expectNoSentWords(page);

      for (const path of [
        "/today",
        "/reminders?tab=overdue",
        "/reminders?tab=history",
        `/clients/${client.id}`,
      ]) {
        await page.goto(path);
        await expectNoSentWords(page);
      }
      await expect(page.getByTestId("reminder-history")).toContainText(
        r.kindShort.before_1,
      );
      await expect(page.getByTestId("reminder-history")).toContainText(
        r.chatOpened,
      );

      await page.goto("/reminders");
      await opened.getByTestId("mark-sent-button").click();
      await expect(opened).toContainText(
        "Отмечено вручную как отправленное",
        SERVER_ROUND_TRIP,
      );
      await expect(opened.getByTestId("mark-sent-button")).toHaveCount(0);

      await page.goto("/reminders?tab=history");
      await expect(
        visibleRows(page, "event-row").filter({ hasText: lastName }),
      ).toContainText("Отмечено вручную");
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, client.id);
    }
  });

  test("criterion 8: the owner's preview fills a real client in and highlights unknown variables", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.goto("/reminders");
    await page.getByRole("link", { name: r.screen.settingsLink }).click();
    await expect(page).toHaveURL(/\/settings\/reminders$/);
    await expect(page.getByText(/^Пример для клиента \S+ \S+$/)).toBeVisible();

    const first = page.getByTestId("template-before_7");
    const preview = first.getByTestId("template-preview");
    await expect(preview).toContainText("Здравствуйте,");
    await expect(preview).not.toContainText("{");

    const field = first.getByRole("textbox");
    await field.fill("Добрый день, {имя}! Ваш {телефон} и {сумма} тенге.");
    await expect(preview).toContainText("Добрый день,");
    await expect(preview).toContainText("{телефон}");
    await expect(first.getByTestId("unknown-variable")).toHaveText("{телефон}");
    await expect(first).toContainText(
      fmt(r.settings.unknown, { tokens: "{телефон}" }),
    );

    // A bad day count is refused next to its field and nothing is saved.
    await page.getByLabel(r.settings.secondDays).fill("10");
    await page.getByRole("button", { name: r.settings.save }).click();
    await expect(page.getByText(r.settings.errors.secondDays)).toBeVisible();

    // Back to the stored values: saving them changes nothing and confirms.
    await page.reload();
    await expect(page.getByLabel(r.settings.secondDays)).toHaveValue("1");
    await page.getByRole("button", { name: r.settings.save }).click();
    await expect(page.getByTestId("settings-status")).toHaveText(
      r.settings.saved,
      SERVER_ROUND_TRIP,
    );
    expect(consoleErrors).toEqual([]);
  });

  test("step 19, criteria 3 and 8: a new language in the card, and the next WhatsApp text is in it", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    // Two saves and four screens on both widths.
    test.setTimeout(90_000);
    const lastName = surname("Тілші");
    const client = await childEndingTomorrow(supabase, lastName);
    const now = new Date();
    try {
      await stubWhatsApp(page);
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);

      // The card shows the language and the reminder as the client will read it: Russian first.
      await page.goto(`/clients/${client.id}`);
      const preview = page.getByTestId("reminder-preview");
      await expect(preview).toContainText("Здравствуйте, Гульнара!");
      await expect(
        page.getByText(LOCALE_NAMES.ru, { exact: true }).first(),
      ).toBeVisible();

      const setLanguage = async (locale: "kk" | "uz") => {
        await menuLink(page, ru.clients.edit).click();
        await page.getByLabel(ru.clientForm.messageLocale).selectOption(locale);
        await page.getByRole("button", { name: ru.clientForm.save }).click();
        await expect(page).toHaveURL(
          new RegExp(`/clients/${client.id}$`),
          SERVER_ROUND_TRIP,
        );
      };
      const todayLink = async () => {
        await menuLink(page, ru.nav.today).click();
        const row = visibleRows(page, "remind-row").filter({
          hasText: lastName,
        });
        await expect(row).toHaveCount(1);
        const href =
          (await row.getByTestId("whatsapp-button").getAttribute("href")) ?? "";
        return { row, text: new URL(href).searchParams.get("text") ?? "" };
      };

      // Kazakh: the card and the Today link change at once, date in Kazakh.
      await setLanguage("kk");
      await expect(preview).toContainText("Сәлеметсіз бе, Гульнара!");
      await expect(preview).toContainText(
        formatDate(client.periodEnd, now, "kk"),
      );
      const cardHref =
        (await page
          .getByTestId("reminder-preview")
          .locator("xpath=..")
          .getByTestId("whatsapp-button")
          .getAttribute("href")) ?? "";
      expect(new URL(cardHref).searchParams.get("text")).toBe(
        (await preview.innerText()).trim(),
      );
      const kazakh = await todayLink();
      expect(kazakh.text).toContain("Сәлеметсіз бе, Гульнара!");
      expect(kazakh.text).toContain(formatDate(client.periodEnd, now, "kk"));
      expect(kazakh.text).not.toContain("Здравствуйте");

      // Uzbek, without reloading the page by hand: the next chat opens with the Uzbek text.
      await page.goto(`/clients/${client.id}`);
      await setLanguage("uz");
      await expect(preview).toContainText("Ассалому алайкум, Гульнара!");
      const uzbek = await todayLink();
      expect(uzbek.text).toContain("Ассалому алайкум, Гульнара!");
      expect(uzbek.text).toContain(formatDate(client.periodEnd, now, "uz"));
      const popup = await openChat(uzbek.row, page);
      // Criterion 8: the Uzbek letters survive the wa.me link as typed.
      expect(new URL(popup.url()).searchParams.get("text")).toBe(uzbek.text);
      await popup.close();
      await expect(uzbek.row).toHaveCount(0, SERVER_ROUND_TRIP);

      // The event names the Uzbek template.
      const db = serviceClient(supabase);
      const { data: events } = await db
        .from("reminder_events")
        .select("template_id")
        .eq("client_id", client.id);
      const { data: template } = await db
        .from("message_templates")
        .select("id")
        .eq("kind", "before_1")
        .eq("locale", "uz")
        .single();
      expect(events).toEqual([{ template_id: template?.id }]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archive(supabase, client.id);
    }
  });

  test("an admin sees no settings link and cannot open the settings", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/reminders");
    await expect(
      page.getByRole("link", { name: r.screen.settingsLink }),
    ).toHaveCount(0);
    const response = await page.goto("/settings/reminders");
    expect(response?.status()).toBe(403);
  });

  test("tabs switch by address and the history filter keeps its values", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/reminders");
    const tabs = page.getByRole("navigation", { name: r.screen.tabsLabel });
    await tabs.getByRole("link", { name: r.screen.tabs.overdue }).click();
    await expect(page).toHaveURL(/tab=overdue$/);
    await expect(
      tabs.getByRole("link", { name: r.screen.tabs.overdue }),
    ).toHaveAttribute("aria-current", "page");
    await expect(visibleRows(page, "overdue-row").first()).toBeVisible();

    await tabs.getByRole("link", { name: r.screen.tabs.history }).click();
    const yesterday = addDays(businessDate(new Date()), -1);
    await page.getByLabel(r.screen.historyDate).fill(yesterday);
    await page.getByRole("button", { name: r.screen.historyShow }).click();
    await expect(page).toHaveURL(new RegExp(`date=${yesterday}`));
    await expect(page.getByLabel(r.screen.historyDate)).toHaveValue(yesterday);
  });
});
