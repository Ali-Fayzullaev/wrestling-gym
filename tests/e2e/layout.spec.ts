import { mkdir } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { devUi } from "@/i18n/dev-ui";
import { ru } from "@/i18n/ru";

import { SEED_EMAILS, SEED_PASSWORD } from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { bottomNav, loginAs } from "./support/auth";

const SCREENSHOT_DIR = "docs/spec/screenshots/04";

/** A person taps the label; the radio button itself is visually hidden. */
async function chooseTheme(page: Page, label: string): Promise<void> {
  await page.getByRole("main").getByText(label, { exact: true }).click();
  await expect(page.getByRole("main").getByLabel(label)).toBeChecked();
}

function sideNav(page: Page) {
  return page.getByRole("complementary").getByRole("navigation", {
    name: ru.nav.label,
  });
}

test.describe("phone layout", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "phone layout only");
  });

  test("bottom menu has four items with 44px targets and navigates", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    const nav = bottomNav(page);
    await expect(nav).toBeVisible();
    await expect(sideNav(page)).toBeHidden();

    const links = nav.getByRole("link");
    await expect(links).toHaveText([
      ru.nav.today,
      ru.nav.clients,
      ru.nav.groups,
      ru.nav.more,
    ]);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(nav.getByRole("link", { name: ru.nav.today })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: ru.nav.groups }).click();
    await expect(page).toHaveURL(/\/groups$/);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.groups }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: ru.nav.groups }),
    ).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: ru.nav.clients }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.clients }),
    ).toBeVisible();

    // The fixed menu must not cover the end of the page.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const menuTop = (await nav.boundingBox())?.y ?? 0;
    const lastLine = await page
      .getByTestId("client-row")
      .filter({ visible: true })
      .last()
      .boundingBox();
    expect(
      (lastLine?.y ?? Infinity) + (lastLine?.height ?? 0),
    ).toBeLessThanOrEqual(menuTop);

    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("computer layout", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "computer layout only");
  });

  test("side menu is shown and the bottom menu is not", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await expect(sideNav(page)).toBeVisible();
    await expect(bottomNav(page)).toBeHidden();
    await expect(
      sideNav(page).getByRole("link", { name: ru.nav.today }),
    ).toHaveAttribute("aria-current", "page");

    await sideNav(page).getByRole("link", { name: ru.nav.clients }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(
      sideNav(page).getByRole("link", { name: ru.nav.clients }),
    ).toHaveAttribute("aria-current", "page");
    expect(consoleErrors).toEqual([]);
  });

  test("menu works from the keyboard with a visible focus", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.waitForLoadState("networkidle");

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: ru.nav.skipToContent }),
    ).toBeFocused();

    const clients = sideNav(page).getByRole("link", { name: ru.nav.clients });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(clients).toBeFocused();
    const ring = await clients.evaluate(
      (element) => getComputedStyle(element).boxShadow,
    );
    expect(ring).not.toBe("none");

    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/focus-desktop-light.png`,
    });

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/clients$/);
  });
});

test.describe("theme", () => {
  test("a chosen theme survives a reload and is applied before the page paints", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/more");
    const html = page.locator("html");

    await chooseTheme(page, ru.theme.dark);
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);

    // Record <html>'s classes from a script placed right after <body> opens: it runs during
    // parsing, before anything in the body is painted, so a theme set later would flash.
    await page.route("**/more", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        /<body[^>]*>/,
        (tag) =>
          `${tag}<script>window.__firstPaintClass=document.documentElement.className</script>`,
      );
      await route.fulfill({ response, body });
    });
    await page.reload();
    const firstPaintClass = await page.evaluate(
      () =>
        (window as Window & { __firstPaintClass?: string }).__firstPaintClass,
    );
    expect(firstPaintClass).toMatch(/(^|\s)dark(\s|$)/);
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(
      page.getByRole("main").getByLabel(ru.theme.dark),
    ).toBeChecked();
    await page.unroute("**/more");

    await chooseTheme(page, ru.theme.light);
    await page.reload();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    expect(consoleErrors).toEqual([]);
  });

  test("the sign-in page follows the saved theme too", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "theme", value: "dark", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("system means the device setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });
});

test.describe("components", () => {
  test("status badges carry the status as text, not colour alone", async ({
    page,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/dev/ui");
    const badges = page.getByTestId("status-badges").locator("[data-status]");
    await expect(badges).toHaveText([
      ru.status.active,
      ru.status.expiring,
      ru.status.expired,
      ru.status.none,
    ]);
    expect(consoleErrors).toEqual([]);
  });

  test("the form dialog is a bottom sheet on a phone and a centred dialog on a computer", async ({
    page,
  }, testInfo) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/dev/ui");
    await page.getByRole("button", { name: devUi.openDialog }).click();
    const dialog = page.getByRole("dialog", { name: devUi.dialogTitle });
    await expect(dialog).toBeVisible();
    const viewport = page.viewportSize();
    if (testInfo.project.name === "mobile") {
      // Wait out the slide-in, then the sheet sits on the bottom edge.
      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          return Math.round((box?.y ?? 0) + (box?.height ?? 0));
        })
        .toBe(viewport?.height);
    } else {
      const box = await dialog.boundingBox();
      expect(box?.width).toBeLessThan(600);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
