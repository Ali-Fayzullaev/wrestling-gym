import { ru } from "@/i18n/ru";

import { expect, test } from "./fixtures";

test("home page renders the title without console errors", async ({
  page,
  consoleErrors,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: ru.home.title }),
  ).toBeVisible();
  await expect(page.getByText(ru.home.subtitle)).toBeVisible();
  await expect(page).toHaveTitle(ru.app.name);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");

  await page.waitForLoadState("networkidle");
  expect(consoleErrors).toEqual([]);
});

test("home page has no horizontal scroll", async ({ page }) => {
  await page.goto("/");

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
