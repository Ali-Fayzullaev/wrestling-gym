import { expect, type Page } from "@playwright/test";

import { ru } from "@/i18n/ru";

/** The form's own error; Next's route announcer is a second role=alert outside main. */
export function formAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

/**
 * Fills and submits the sign-in form on the current /login page and waits for the server's
 * answer, so consecutive attempts never overlap.
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

/** Waits for the newest email to `to` in the local Mailpit and returns its HTML body. */
export async function latestEmailHtml(
  mailpitUrl: string,
  to: string,
): Promise<string> {
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}"`);
        const response = await fetch(
          `${mailpitUrl}/api/v1/search?query=${query}`,
        );
        const body = (await response.json()) as { messages?: { ID: string }[] };
        messageId = body.messages?.[0]?.ID;
        return messageId;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const response = await fetch(`${mailpitUrl}/api/v1/message/${messageId}`);
  const message = (await response.json()) as { HTML: string };
  return message.HTML;
}
