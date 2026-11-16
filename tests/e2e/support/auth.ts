import { expect, type Page } from "@playwright/test";

import { ru } from "@/i18n/ru";

/** The form's own error; Next's route announcer is a second role=alert outside main. */
export function formAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

/**
 * Fills and submits the sign-in form on the current /login page and waits until the action has
 * finished, so consecutive attempts never overlap.
 */
export async function submitLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel(ru.auth.email).fill(email);
  await page.getByLabel(ru.auth.password, { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/login",
    ),
    page.getByRole("button", { name: ru.auth.login.submit }).click(),
  ]);
  // The response headers arrive before the action finishes. React then resets the form's
  // uncontrolled fields, so filling the next attempt earlier could lose the typed password.
  await expect(
    page.getByRole("button", { name: ru.auth.login.pending }),
  ).toHaveCount(0);
}

export async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await submitLogin(page, email, password);
  await expect(page).toHaveURL(/\/today$/);
}

/** The bottom menu is the phone layout; the side menu replaces it from md up. */
export function bottomNav(page: Page) {
  return page.locator('nav[data-slot="bottom-nav"]');
}

/**
 * Owner sections and sign-out live in the side menu on a computer and behind "More" on a phone.
 * Opens "More" when the bottom menu is what the employee sees.
 */
export async function openMoreOnPhone(page: Page): Promise<void> {
  if (await bottomNav(page).isVisible()) {
    await bottomNav(page).getByRole("link", { name: ru.nav.more }).click();
    await expect(page).toHaveURL(/\/more$/);
  }
}

export async function signOut(page: Page): Promise<void> {
  await openMoreOnPhone(page);
  await page.getByRole("button", { name: ru.auth.logout }).click();
}

/**
 * The signed-in role line of the current screen. Next keeps earlier screens in the DOM, hidden,
 * after a client-side navigation, so only the visible one counts.
 */
export function actorRole(page: Page) {
  return page.getByTestId("actor-role").filter({ visible: true });
}
