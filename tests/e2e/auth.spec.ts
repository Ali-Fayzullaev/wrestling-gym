import { randomUUID } from "node:crypto";

import { ru } from "@/i18n/ru";

import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
  setStaffActive,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import {
  actorRole,
  formAlert,
  latestEmailHtml,
  loginAs,
  openMoreOnPhone,
  signOut,
  submitLogin,
} from "./support/auth";

test.describe("sign-in", () => {
  test("right password opens Today with a hardened session cookie", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.today }),
    ).toBeVisible();
    await expect(actorRole(page)).toHaveText(ru.roles.owner);

    const sessionCookies = (await context.cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    );
    expect(sessionCookies.length).toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
      // `next start` is a production build, so the cookie is Secure here too.
      expect(cookie.secure).toBe(true);
    }

    await page.waitForLoadState("networkidle");
    expect(consoleErrors).toEqual([]);
  });

  test("wrong password and unknown email get the same message", async ({
    page,
    supabase,
  }) => {
    // A throwaway account: failed attempts count against the email's rate limit.
    const staff = await createTempStaff(supabase, "admin");
    const shown: string[] = [];
    for (const email of [staff.email, `${randomUUID()}@example.test`]) {
      await page.goto("/login");
      await submitLogin(page, email, "not-the-password");
      await expect(formAlert(page)).toBeVisible();
      await expect(page).toHaveURL(/\/login$/);
      shown.push(await page.getByRole("main").innerText());
    }
    expect(shown[0]).toContain(ru.auth.login.invalidCredentials);
    // Same page text apart from the typed email, which the form keeps.
    expect(shown[1]).toBe(shown[0]);
  });

  test("returns to the page that asked for sign-in", async ({ page }) => {
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/login\?next=%2Fclients$/);

    await submitLogin(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/clients$/);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.clients }),
    ).toBeVisible();
  });

  for (const next of [
    "//evil.example/today",
    "https://evil.example/",
    "/\\evil.example",
  ]) {
    test(`ignores an external return address ${next}`, async ({ page }) => {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await submitLogin(page, SEED_EMAILS.admin, SEED_PASSWORD);
      await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/today$/);
    });
  }

  test("works when submitted before the scripts have loaded", async ({
    page,
  }) => {
    // Slow 4G: the admin may tap "Войти" before hydration, so the form posts natively.
    let releaseScripts = () => {};
    const scriptsHeld = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      await scriptsHeld;
      await route.continue();
    });
    await page.goto("/login?next=%2Fclients", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel(ru.auth.email).fill(SEED_EMAILS.admin);
    await page
      .getByLabel(ru.auth.password, { exact: true })
      .fill(SEED_PASSWORD);
    await page.getByRole("button", { name: ru.auth.login.submit }).click();
    releaseScripts();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.clients }),
    ).toBeVisible();
  });

  test("signed-in staff skip the sign-in page", async ({ page }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/today$/);
  });

  test("blocks sign-in after 5 failed attempts and names the wait", async ({
    page,
  }) => {
    const email = `${randomUUID()}@example.test`;
    await page.goto("/login");
    for (let i = 0; i < 5; i += 1) {
      await submitLogin(page, email, `wrong-${i}`);
      await expect(formAlert(page)).toHaveText(
        ru.auth.login.invalidCredentials,
      );
    }
    await submitLogin(page, email, "wrong-again");
    await expect(formAlert(page)).toHaveText(ru.auth.tooManyAttempts(15));
  });
});

test.describe("roles", () => {
  for (const path of ["/reports", "/audit", "/settings/staff"]) {
    test(`admin gets 403 on ${path}`, async ({ page }) => {
      await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
      const response = await page.goto(path);
      expect(response?.status()).toBe(403);
      await expect(
        page.getByRole("heading", { level: 1, name: ru.forbidden.title }),
      ).toBeVisible();
    });
  }

  test("owner opens the reports page", async ({ page }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await openMoreOnPhone(page);
    await page.getByRole("link", { name: ru.nav.reports }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.reports }),
    ).toBeVisible();

    const response = await page.goto("/settings/staff");
    expect(response?.status()).toBe(200);
  });
});

test.describe("session", () => {
  test("a deactivated employee is sent to sign-in on the next request", async ({
    page,
    supabase,
  }) => {
    const staff = await createTempStaff(supabase, "admin");
    await loginAs(page, staff.email, staff.password);
    // Let the menu finish prefetching first: a prefetch answered after the deactivation redirects
    // the router to sign-in by itself and would abort the navigation under test.
    await page.waitForLoadState("networkidle");

    await setStaffActive(supabase, staff.id, false);
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/login(\?|$)/);

    // The session is gone, not just hidden: signing in again is refused too.
    await submitLogin(page, staff.email, staff.password);
    await expect(formAlert(page)).toHaveText(ru.auth.login.accessDisabled);
  });

  test("the next employee on the same device sees their own role", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await expect(actorRole(page)).toHaveText(ru.roles.admin);
    await openMoreOnPhone(page);
    await expect(actorRole(page)).toHaveText(ru.roles.admin);
    await expect(page.getByRole("link", { name: ru.nav.reports })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: ru.auth.logout }).click();
    await expect(page).toHaveURL(/\/login$/);

    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await expect(actorRole(page)).toHaveText(ru.roles.owner);
    await openMoreOnPhone(page);
    await expect(actorRole(page)).toHaveText(ru.roles.owner);
    await page.waitForLoadState("networkidle");
    // No retrying assertion: the menu must not show the previous employee's role even briefly.
    expect(await page.getByRole("link", { name: ru.nav.reports }).count()).toBe(
      1,
    );
  });

  test("another site cannot end the session", async ({ page }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    const crossSite: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      { origin: "https://evil.example" },
      {},
    ];
    for (const headers of crossSite) {
      const response = await page.request.post("/auth/sign-out", {
        headers,
        maxRedirects: 0,
      });
      expect(response.status()).toBe(403);
    }
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/clients$/);
  });

  test("sign-out ends the session", async ({ page, context }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);

    const sessionCookies = (await context.cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    );
    expect(sessionCookies).toEqual([]);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  });
});

test.describe("password reset", () => {
  test("the emailed link opens the new-password form and the new password works", async ({
    page,
    supabase,
  }) => {
    const staff = await createTempStaff(supabase, "admin");

    await page.goto("/login");
    await page.getByRole("link", { name: ru.auth.login.forgot }).click();
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByLabel(ru.auth.email).fill(staff.email);
    await page.getByRole("button", { name: ru.auth.reset.submit }).click();
    await expect(page.getByRole("status")).toHaveText(ru.auth.reset.sent);

    const html = await latestEmailHtml(supabase.mailpitUrl, staff.email);
    const link = /href="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&");
    expect(link).toMatch(/\/auth\/confirm\?token_hash=[^&]+&type=recovery$/);

    await page.goto(link ?? "");
    await expect(page).toHaveURL(/\/update-password$/);
    const newPassword = `new-${randomUUID()}`;
    await page.getByLabel(ru.auth.update.password).fill(newPassword);
    await page.getByLabel(ru.auth.update.confirm).fill(newPassword);
    await page.getByRole("button", { name: ru.auth.update.submit }).click();
    await expect(page).toHaveURL(/\/today$/);

    await signOut(page);
    await submitLogin(page, staff.email, newPassword);
    await expect(page).toHaveURL(/\/today$/);
  });

  test("an unknown email gets the same answer as a known one", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await page.getByLabel(ru.auth.email).fill(`${randomUUID()}@example.test`);
    await page.getByRole("button", { name: ru.auth.reset.submit }).click();
    await expect(page.getByRole("status")).toHaveText(ru.auth.reset.sent);
  });

  test("a broken link leads back to the request form with an explanation", async ({
    page,
  }) => {
    await page.goto("/auth/confirm?token_hash=not-a-token&type=recovery");
    await expect(page).toHaveURL(/\/reset-password\/expired$/);
    await expect(formAlert(page)).toHaveText(ru.auth.reset.linkInvalid);
  });
});

test("pages have no horizontal scroll", async ({ page }) => {
  for (const path of ["/login", "/reset-password"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, path).toBe(0);
  }
  await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "/today").toBe(0);
});
