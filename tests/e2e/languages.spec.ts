import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import type { Locator, Page, TestInfo } from "@playwright/test";

import { fmt } from "@/i18n/format";
import { kk } from "@/i18n/kk";
import type { Messages } from "@/i18n/messages";
import { ru } from "@/i18n/ru";
import { uz } from "@/i18n/uz";
import { formatWeekdayDate } from "@/lib/format";
import { HTML_LANG, type Locale, LOCALE_NAMES } from "@/lib/locale";

import { createTempStaff, serviceClient } from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

// Step 16: the interface in Russian, Kazakh and Uzbek (Cyrillic). Each test signs in a throwaway
// employee, so changing the language never touches the seed accounts other tests share.

const DICTIONARIES: Record<Locale, Messages> = { ru, kk, uz };
const SCREENSHOT_DIR = "docs/spec/screenshots/16";
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_OWNER = "00000000-0000-4000-8000-000000000001";

type Supabase = Parameters<typeof serviceClient>[0];

/** Unique Cyrillic surname: letters only, so search treats it as one word. */
function surname(): string {
  const letters = "абвгдежзиклмнопрстуф";
  const tail = Array.from(
    { length: 7 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join("");
  return `Тил${tail}`;
}

async function newClient(supabase: Supabase, lastName: string) {
  const id = randomUUID();
  const phone = `+7700${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { error } = await serviceClient(supabase).from("clients").insert({
    id,
    last_name: lastName,
    first_name: "Тест",
    phone,
    phone_owner: "self",
    group_id: SEED_GROUP,
    started_on: "2026-11-01",
    created_by: SEED_OWNER,
  });
  if (error) throw new Error(`client insert failed: ${error.code}`);
  return id;
}

/** Payments cannot be deleted: the client leaves the lists and counters through the archive. */
async function archive(supabase: Supabase, id: string) {
  await serviceClient(supabase)
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
}

async function snap(page: Page, testInfo: TestInfo, name: string) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: `${SCREENSHOT_DIR}/${name}-${testInfo.project.name}.png`,
    fullPage: true,
  });
}

/** A person taps the label; the radio button itself is visually hidden. */
async function chooseLanguage(page: Page, locale: Locale) {
  await page.goto("/more");
  await page
    .getByRole("main")
    .getByText(LOCALE_NAMES[locale], { exact: true })
    .click();
  // The page loads again in the new language.
  await expect(page.locator("html")).toHaveAttribute("lang", HTML_LANG[locale]);
  await expect(
    page.getByRole("main").getByLabel(LOCALE_NAMES[locale]),
  ).toBeChecked();
}

function heading(page: Page): Locator {
  return page.getByRole("main").getByRole("heading", { level: 1 });
}

/** Main menu of the current layout: the bottom one on a phone, the side one on a computer. */
function menu(page: Page, t: Messages): Locator {
  return page
    .getByRole("navigation", { name: t.nav.label })
    .filter({ visible: true });
}

const rowStatus = (row: Locator) =>
  row.locator("[data-slot=status-badge]").filter({ visible: true });

/** Russian words that must not show up once another language is chosen. */
async function expectNoRussian(page: Page) {
  const main = page.getByRole("main");
  for (const text of [ru.nav.today, ru.nav.clients, ru.status.active]) {
    await expect(main.getByText(text, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("navigation").getByText(text, { exact: true }),
    ).toHaveCount(0);
  }
}

for (const locale of ["kk", "uz", "ru"] as const) {
  const t = DICTIONARIES[locale];

  test.describe(`interface in ${locale}`, () => {
    test("criteria 1 and 4: More, Today, clients and a payment in the chosen language", async ({
      page,
      supabase,
      consoleErrors,
    }, testInfo) => {
      const staff = await createTempStaff(supabase, "admin");
      const lastName = surname();
      const clientId = await newClient(supabase, lastName);
      try {
        await loginAs(page, staff.email, staff.password);
        await chooseLanguage(page, locale);
        await expect(heading(page)).toHaveText(t.pages.more);
        await expect(page.getByRole("main")).toContainText(t.theme.label);
        if (locale === "ru") {
          await expect(page.getByText(t.language.draftNote)).toHaveCount(0);
        } else {
          await expect(page.getByText(t.language.draftNote)).toBeVisible();
        }
        await snap(page, testInfo, `${locale}-more`);

        // Today: header, weekday and date, counters, menu.
        await page.goto("/today");
        await expect(heading(page)).toHaveText(t.pages.today);
        await expect(page.getByRole("main")).toContainText(
          formatWeekdayDate(new Date(), locale),
        );
        await expect(
          page.getByRole("main").getByText(t.today.counters.debtors).first(),
        ).toBeVisible();
        await expect(
          menu(page, t).getByRole("link", { name: t.nav.clients }),
        ).toBeVisible();
        if (locale !== "ru") await expectNoRussian(page);
        await snap(page, testInfo, `${locale}-today`);

        // Clients: search, status, and the payment dialog from the list.
        await page.goto("/clients");
        await expect(heading(page)).toHaveText(t.pages.clients);
        await page
          .getByRole("searchbox", { name: t.clientsList.search })
          .fill(lastName);
        const row = page
          .getByTestId("client-row")
          .filter({ hasText: lastName });
        await expect(row).toHaveCount(1);
        await expect(rowStatus(row)).toHaveText(t.status.none);
        await expect(page.getByTestId("clients-found")).toHaveText(
          fmt(t.clientsList.found, { count: 1 }),
        );
        await snap(page, testInfo, `${locale}-clients`);

        await row.getByTestId("row-pay").click();
        const dialog = page.getByRole("dialog").filter({ visible: true });
        await expect(dialog).toContainText(t.payments.dialog.title);
        await expect(dialog.getByLabel(t.payments.dialog.amount)).toHaveValue(
          /^\d+$/,
        );
        await expect(dialog).toContainText(t.payments.dialog.methods.kaspi);
        await snap(page, testInfo, `${locale}-payment`);
        await dialog.getByTestId("payment-confirm").click();
        await expect(rowStatus(row)).toHaveText(t.status.active);
        const savedPrefix = t.payments.saved.split("{until}")[0] ?? "";
        await expect(page.getByText(savedPrefix.trim()).first()).toBeVisible();

        // The client card: subscription and the payment history in the same language.
        await page.goto(`/clients/${clientId}`);
        await expect(page.getByRole("main")).toContainText(
          t.clients.card.subscription,
        );
        await expect(page.getByTestId("payment-history")).toContainText(
          fmt(t.payments.history.by, { name: "Тестовый сотрудник" }),
        );
        if (locale !== "ru") await expectNoRussian(page);
        await snap(page, testInfo, `${locale}-client`);

        expect(consoleErrors).toEqual([]);
      } finally {
        await archive(supabase, clientId);
      }
    });
  });
}

test.describe("language outside the profile", () => {
  test("after sign-out the sign-in page keeps the chosen language", async ({
    page,
    supabase,
  }, testInfo) => {
    const staff = await createTempStaff(supabase, "admin");
    await loginAs(page, staff.email, staff.password);
    await chooseLanguage(page, "uz");
    await page
      .getByRole("main")
      .getByRole("button", { name: uz.auth.logout })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "uz-Cyrl");
    await expect(heading(page)).toHaveText(uz.auth.login.title);
    await expect(page.getByLabel(uz.auth.password)).toBeVisible();
    await snap(page, testInfo, "uz-login");
  });

  test("the language follows the profile to another device", async ({
    page,
    browser,
    supabase,
  }) => {
    const staff = await createTempStaff(supabase, "admin");
    await loginAs(page, staff.email, staff.password);
    await chooseLanguage(page, "kk");

    // A fresh browser has no language cookie: the profile decides after sign-in.
    const other = await browser.newContext({ locale: "ru-RU" });
    const second = await other.newPage();
    try {
      await second.setExtraHTTPHeaders({
        "x-forwarded-for": `198.19.${Math.floor(Math.random() * 255)}.7`,
      });
      await second.goto("/login");
      await expect(heading(second)).toHaveText(ru.auth.login.title);
      await second.getByLabel(ru.auth.email).fill(staff.email);
      await second
        .getByLabel(ru.auth.password, { exact: true })
        .fill(staff.password);
      await second.getByRole("button", { name: ru.auth.login.submit }).click();
      await expect(second).toHaveURL(/\/today$/);
      await expect(second.locator("html")).toHaveAttribute("lang", "kk");
      await expect(heading(second)).toHaveText(kk.pages.today);
    } finally {
      await other.close();
    }
  });

  test("a wrong password is refused in the language of the sign-in page", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: "kk-KZ" });
    const page = await context.newPage();
    try {
      await page.setExtraHTTPHeaders({
        "x-forwarded-for": `198.20.${Math.floor(Math.random() * 255)}.9`,
      });
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("lang", "kk");
      await expect(heading(page)).toHaveText(kk.auth.login.title);
      await page.getByLabel(kk.auth.email).fill("nobody@example.test");
      await page
        .getByLabel(kk.auth.password, { exact: true })
        .fill("wrong-password");
      await page.getByRole("button", { name: kk.auth.login.submit }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        kk.auth.login.invalidCredentials,
      );
    } finally {
      await context.close();
    }
  });

  test("a browser header cannot pick the language of a signed-in employee", async ({
    page,
    supabase,
  }) => {
    const staff = await createTempStaff(supabase, "admin");
    await loginAs(page, staff.email, staff.password);
    await page.setExtraHTTPHeaders({
      "x-app-locale": "uz",
      "accept-language": "kk-KZ",
    });
    await page.goto("/today");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await expect(heading(page)).toHaveText(ru.pages.today);
  });
});

test.describe("export in the language of whoever downloads", () => {
  test("the owner's client file has Kazakh headers", async ({
    page,
    supabase,
  }) => {
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);
    await chooseLanguage(page, "kk");
    const response = await page.request.get(
      "/reports/export?data=clients&format=csv",
    );
    expect(response.status()).toBe(200);
    const text = (await response.body()).toString("utf8");
    expect(text.replace(/^﻿/, "").split("\r\n")[0]).toBe(
      kk.reports.file.clientsHeader.join(";"),
    );
  });
});
