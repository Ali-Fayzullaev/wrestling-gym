import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { fmt } from "@/i18n/format";
import { ru } from "@/i18n/ru";

import { defined } from "../support/defined";
import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

// The client screens read three sections; the specs keep one handle.
const clientsText = {
  ...ru.clients,
  list: ru.clientsList,
  form: ru.clientForm,
};

const c = clientsText;
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const SEED_GROUP_NAME = "Дети 6–9 лет, утро";
/** Seed client 1 (supabase/seed.sql): phone +77000000001. */
const SEED_CLIENT = "20000000-0000-4000-8000-000000000001";
const SEED_PHONE = "+77000000001";
// Client screens: ids only; the fixed paths carry no data (the owner's list prefetches the import).
const UUID_PATH = /^\/clients(\/[0-9a-f-]{36}(\/edit)?|\/new|\/import)?$/;

type Supabase = Parameters<typeof serviceClient>[0];

/** A throwaway client (no consents, no payments) so tests do not change the seed clients. */
async function seedClient(
  supabase: Supabase,
  lastName: string,
): Promise<string> {
  const id = randomUUID();
  const phone = `+7700${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { error } = await serviceClient(supabase).from("clients").insert({
    id,
    last_name: lastName,
    first_name: "Тестов",
    phone,
    phone_owner: "self",
    group_id: SEED_GROUP,
    started_on: "2026-11-01",
    created_by: "00000000-0000-4000-8000-000000000001",
  });
  if (error) throw new Error(`client insert failed: ${error.code}`);
  return id;
}

async function removeClients(supabase: Supabase, lastNames: string[]) {
  await serviceClient(supabase)
    .from("clients")
    .delete()
    .in("last_name", lastNames)
    .is("deleted_at", null);
}

function search(page: Page) {
  return page.getByRole("searchbox", { name: c.list.search });
}

function rows(page: Page) {
  return page.getByTestId("client-row");
}

function dialog(page: Page) {
  return page.getByRole("dialog").filter({ visible: true });
}

/** Unique Cyrillic surname: letters only, so search treats it as one word. */
function surname(prefix: string): string {
  const letters = "абвгдежзиклмнопрстуф";
  const tail = Array.from(
    { length: 6 },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join("");
  return `${prefix}${tail}`;
}

test.describe("list", () => {
  test("criterion 6: search over the seed list makes no network request", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/clients", { waitUntil: "load" });
    await expect(rows(page).first()).toBeVisible();
    // Let the deferred toast area and any idle work finish before counting.
    await expect(
      page.locator("section[aria-label^='Notifications']"),
    ).toBeAttached({
      timeout: 10_000,
    });
    await page.waitForLoadState("networkidle");
    const total = await rows(page).count();
    expect(total).toBeGreaterThanOrEqual(140);

    // Requests for data or pages. Typing a Kazakh letter may fetch the font subset that draws it
    // (a static file, not data); that is allowed, nothing else is.
    const requests: string[] = [];
    const assets: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") assets.push(request.url());
      else requests.push(`${request.resourceType()} ${request.url()}`);
    });

    // "Касымов" in the seeds; typed with Kazakh letters and in capitals.
    await search(page).pressSequentially("ҚАСЫМ");
    await expect(rows(page).first()).toContainText("Касымов");
    const found = await rows(page).allTextContents();
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(total);
    for (const text of found) expect(text).toContain("Касымов");

    await search(page).fill("");
    await search(page).pressSequentially("+7 700 000 00 42");
    await expect(rows(page)).toHaveCount(1);

    await page.getByRole("button", { name: c.list.clearSearch }).click();
    await expect(rows(page)).toHaveCount(total);

    expect(requests, requests.join("\n")).toEqual([]);
    for (const url of assets)
      expect(new URL(url).pathname).toMatch(/^\/_next\/static\/media\//);
    expect(consoleErrors).toEqual([]);
  });

  test("criterion 7: filters go to the URL and a link restores them", async ({
    page,
    browser,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/clients");
    await page
      .getByLabel(c.list.group)
      .selectOption({ label: SEED_GROUP_NAME });
    await page.getByLabel(c.list.status).selectOption("expired");
    await page.getByLabel(c.list.sort).selectOption("ends");
    await expect(page).toHaveURL(
      `/clients?group=${SEED_GROUP}&status=expired&sort=ends`,
    );
    const count = await rows(page).count();
    expect(count).toBeGreaterThan(0);
    for (const badge of await rows(page)
      .locator("[data-status]")
      .filter({ visible: true })
      .all())
      await expect(badge).toHaveAttribute("data-status", "expired");
    const names = await rows(page).allTextContents();

    // The same link in another signed-in browser tab.
    const context = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.getByLabel(c.list.group)).toHaveValue(SEED_GROUP);
    await expect(other.getByLabel(c.list.status)).toHaveValue("expired");
    await expect(other.getByLabel(c.list.sort)).toHaveValue("ends");
    expect(await rows(other).allTextContents()).toEqual(names);
    await context.close();

    await page.getByRole("button", { name: c.list.reset }).click();
    await expect(page).toHaveURL("/clients?sort=ends");
  });

  test("criterion 8: an archived client is hidden by default and shown by the archive filter", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Архивный");
    const id = await seedClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto(`/clients/${id}`);
      await page.getByRole("button", { name: c.archive }).click();
      await dialog(page)
        .getByRole("button", { name: c.archiveDialog.confirm })
        .click();
      await expect(page.getByTestId("client-archived")).toBeVisible();
      await expect(
        page.getByText(c.archiveDialog.done, { exact: true }),
      ).toBeVisible();

      await page.getByRole("main").getByRole("link", { name: c.back }).click();
      await expect(page).toHaveURL("/clients");
      await search(page).fill(lastName);
      await expect(rows(page)).toHaveCount(0);
      await page.getByLabel(c.list.archive).selectOption("1");
      await expect(page).toHaveURL("/clients?archive=1");
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page)).toContainText(lastName);

      // Bring back: visible again in the default list.
      await rows(page).click();
      await page.getByRole("button", { name: c.restore }).click();
      await dialog(page)
        .getByRole("button", { name: c.restoreDialog.confirm })
        .click();
      await expect(page.getByTestId("client-archived")).toHaveCount(0);
      await page.goto("/clients");
      await search(page).fill(lastName);
      await expect(rows(page)).toHaveCount(1);
    } finally {
      await removeClients(supabase, [lastName]);
    }
  });
});

test.describe("form", () => {
  test("criterion 9: a duplicate phone is reported with the matches, saving is still allowed", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const { data } = await serviceClient(supabase)
      .from("clients")
      .select("last_name, first_name")
      .eq("id", SEED_CLIENT)
      .single();
    const seed = defined(data);
    const lastName = surname("Дублев");
    try {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await page.goto("/clients");
      await page.getByRole("link", { name: c.create }).click();
      await expect(page).toHaveURL("/clients/new");

      await page.getByLabel(c.form.lastName, { exact: true }).fill(lastName);
      await page.getByLabel(c.form.firstName, { exact: true }).fill("Брат");
      await page
        .getByLabel(c.form.phone, { exact: true })
        .fill("8 700 000 00 01");
      await page.getByLabel(c.form.firstName, { exact: true }).focus();
      const warning = page.getByTestId("phone-duplicates");
      await expect(warning).toContainText(c.form.duplicates);
      await expect(warning).toContainText(
        `${seed.last_name} ${seed.first_name}`,
      );

      await page.getByLabel(c.form.phoneOwnerParent).check();
      await page.getByRole("button", { name: c.form.save }).click();
      // The parent's name is required for a parent's phone.
      await expect(page.getByText(c.form.errors.parentName)).toBeVisible();
      await page.getByLabel(c.form.parentName).fill("Гульнара");
      // Next keeps the list screen (with its own "Группа" filter) hidden in the DOM.
      await page
        .locator("form")
        .getByLabel(c.form.group, { exact: true })
        .selectOption({ label: SEED_GROUP_NAME });
      await page.getByLabel(c.form.consentKinds.messaging).check();
      await page.getByRole("button", { name: c.form.save }).click();

      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
      await expect(page.getByText(c.form.created)).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: `${lastName} Брат` }),
      ).toBeVisible();
      await expect(page.getByText("+7 700 000 00 01")).toBeVisible();
      await expect(
        page.getByRole("main").getByRole("link", { name: SEED_GROUP_NAME }),
      ).toBeVisible();
      expect(consoleErrors).toEqual([]);
    } finally {
      // The new client has a consent (append-only), so it stays in the local database; blank it.
      const { data: created } = await serviceClient(supabase)
        .from("clients")
        .select("id")
        .eq("last_name", lastName);
      for (const row of created ?? [])
        await serviceClient(supabase)
          .from("clients")
          .update({
            phone: "+77000000000",
            archived_at: new Date().toISOString(),
          })
          .eq("id", row.id);
    }
  });

  test("a wrong phone stays in the form with a message next to the field", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/clients/new");
    await page.getByLabel(c.form.lastName, { exact: true }).fill("Неверный");
    await page.getByLabel(c.form.firstName, { exact: true }).fill("Номер");
    await page
      .getByLabel(c.form.phone, { exact: true })
      .fill("+7 916 123 45 67");
    await page.getByRole("button", { name: c.form.save }).click();
    await expect(page.getByText(c.form.errors.phone)).toBeVisible();
    await expect(
      page.getByLabel(c.form.phone, { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(c.form.phone, { exact: true })).toHaveValue(
      "+7 916 123 45 67",
    );
    await expect(page).toHaveURL("/clients/new");
  });
});

test.describe("deletion", () => {
  test("an admin sees no delete button", async ({ page }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto(`/clients/${SEED_CLIENT}`);
    await expect(page.getByRole("button", { name: c.archive })).toBeVisible();
    await expect(page.getByRole("button", { name: c.delete })).toHaveCount(0);
  });

  test("the owner deletes after choosing a reason and typing the last name", async ({
    page,
    supabase,
  }) => {
    const lastName = surname("Удаляемый");
    const id = await seedClient(supabase, lastName);
    try {
      await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
      await page.goto(`/clients/${id}`);
      await page.getByRole("button", { name: c.delete }).click();
      const confirm = dialog(page).getByRole("button", {
        name: c.deleteDialog.confirm,
      });
      await expect(confirm).toBeDisabled();
      await dialog(page)
        .getByLabel(c.deleteDialog.reason)
        .selectOption("duplicate");
      await dialog(page)
        .getByLabel(fmt(c.deleteDialog.confirmLabel, { lastName }))
        .fill("другая");
      await expect(confirm).toBeDisabled();
      await dialog(page)
        .getByLabel(fmt(c.deleteDialog.confirmLabel, { lastName }))
        .fill(lastName.toUpperCase());
      await confirm.click();
      await expect(page).toHaveURL("/clients");
      await expect(page.getByText(c.deleteDialog.deleted)).toBeVisible();
      // The card streams, so a missing client is a not-found page rather than a 404 status.
      await page.goto(`/clients/${id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: ru.notFound.title }),
      ).toBeVisible();
      await expect(page.locator('img[data-mascot="lost"]')).toBeVisible();
    } finally {
      await removeClients(supabase, [lastName]);
    }
  });
});

test("criterion 11: no phone or name ever appears in a URL", async ({
  page,
  supabase,
}) => {
  const lastName = surname("Секретов");
  const id = await seedClient(supabase, lastName);
  const { data } = await serviceClient(supabase)
    .from("clients")
    .select("last_name, first_name, phone")
    .in("id", [id, SEED_CLIENT]);
  const people = defined(data);
  const forbidden = people.flatMap((p) => [
    p.last_name,
    p.first_name,
    p.phone,
    p.phone.slice(1),
  ]);
  forbidden.push(...forbidden.map((value) => encodeURIComponent(value)));

  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("framenavigated", (frame) => urls.push(frame.url()));

  try {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.goto("/clients");
    await search(page).fill(lastName);
    await search(page).fill(SEED_PHONE.slice(-7));
    await search(page).fill(lastName);
    await page.getByLabel(c.list.status).selectOption("none");
    await rows(page).click();
    await expect(page).toHaveURL(`/clients/${id}`);
    await page.getByRole("link", { name: c.edit }).click();
    await page.getByLabel(c.form.phone, { exact: true }).fill(SEED_PHONE);
    await page.getByLabel(c.form.note).focus();
    await expect(page.getByTestId("phone-duplicates")).toBeVisible();
    await page
      .getByLabel(c.form.phone, { exact: true })
      .fill(people.find((p) => p.last_name === lastName)?.phone ?? "");
    await page.getByLabel(c.form.note).fill("Проверка");
    await page.getByRole("button", { name: c.form.save }).click();
    await expect(page).toHaveURL(`/clients/${id}`);
    await page.getByRole("button", { name: c.archive }).click();
    await dialog(page)
      .getByRole("button", { name: c.archiveDialog.confirm })
      .click();
    await expect(page.getByTestId("client-archived")).toBeVisible();
    await page.goto("/clients/new");
    await page.getByRole("link", { name: ru.nav.clients }).first().click();
    await expect(page).toHaveURL("/clients");
  } finally {
    await removeClients(supabase, [lastName]);
  }

  for (const url of urls) {
    for (const value of forbidden) expect(url, url).not.toContain(value);
    const { pathname, origin } = new URL(url);
    if (
      origin === new URL(page.url()).origin &&
      pathname.startsWith("/clients")
    )
      expect(pathname).toMatch(UUID_PATH);
  }
});
