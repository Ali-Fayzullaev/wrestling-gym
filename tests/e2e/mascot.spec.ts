import type { Locator, Page } from "@playwright/test";

import { ru } from "@/i18n/ru";

import { SEED_EMAILS, SEED_PASSWORD } from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

/** The visible mascot in a part of the page (the side menu's copy is hidden on a phone). */
function mascot(scope: Page | Locator, mood?: string): Locator {
  const selector = mood ? `img[data-mascot="${mood}"]` : "img[data-mascot]";
  return scope.locator(selector).filter({ visible: true }).first();
}

/** Loaded for real (not a broken image), decorative, with its size set against layout shift. */
async function expectShown(image: Locator): Promise<void> {
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "");
  await expect(image).toHaveAttribute("aria-hidden", "true");
  await expect(image).toHaveAttribute("width", /^\d+$/);
  await expect(image).toHaveAttribute("height", /^\d+$/);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
}

test("the login page greets with the mascot", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("/login");
  await expectShown(mascot(page, "hello"));
  expect(consoleErrors).toEqual([]);
});

test("the Today header shows the mascot in a mood that matches the counters", async ({
  page,
  consoleErrors,
}) => {
  await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
  const header = page.getByRole("main").locator("header").first();
  const image = mascot(header);
  await expectShown(image);
  // The seed has debtors, so the mascot is ready for work.
  await expect(image).toHaveAttribute("data-mascot", "focus");
  expect(consoleErrors).toEqual([]);
});

test("a search that finds nobody shows the mascot with a magnifier", async ({
  page,
  consoleErrors,
}) => {
  await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
  await page.goto("/clients");
  await page
    .getByRole("searchbox", { name: ru.clientsList.search })
    .fill("Щщщщщщ");
  const empty = page.getByTestId("empty-state");
  await expect(empty).toContainText(ru.clientsList.nothingFound);
  await expectShown(mascot(empty, "search"));
  expect(consoleErrors).toEqual([]);
});

test("an unknown address shows the lost mascot, a 404 and a way back", async ({
  page,
}) => {
  await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: ru.notFound.title }),
  ).toBeVisible();
  await expectShown(mascot(page, "lost"));
  await page.getByRole("link", { name: ru.notFound.back }).click();
  await expect(page).toHaveURL(/\/today$/);
});

test("an admin refused an owner page sees the stop mascot with the 403", async ({
  page,
}) => {
  await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
  const response = await page.goto("/reports");
  expect(response?.status()).toBe(403);
  const image = page.locator('img[src="/mascot/stop.svg"]');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});
