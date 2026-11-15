import type { Page } from "@playwright/test";

import { ru } from "@/i18n/ru";

import { SEED_EMAILS, SEED_PASSWORD } from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

const CONSTANT_HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

declare global {
  interface Window {
    /** Filled by the init script in watchViolations. */
    __cspViolations?: string[];
  }
}

type WithHeaders = { headers(): Record<string, string> };

function expectConstantHeaders(response: WithHeaders): void {
  const headers = response.headers();
  for (const [name, value] of Object.entries(CONSTANT_HEADERS)) {
    expect(headers[name], name).toBe(value);
  }
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
  expect(headers["x-powered-by"]).toBeUndefined();
}

function scriptNonce(csp: string): string | undefined {
  return /'nonce-([^']+)'/.exec(csp)?.[1];
}

function expectStrictPolicy(csp: string | undefined): void {
  expect(csp).toBeDefined();
  const policy = csp ?? "";
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]{20,}'/);
  // Production runs without eval and without blanket inline scripts.
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toMatch(/script-src [^;]*'unsafe-inline'/);
}

/** Collects CSP violations reported by the browser on every page of the test. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, "__cspViolations", { value: seen });
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => window.__cspViolations ?? ["violation log missing"]);
}

test.describe("security headers", () => {
  test("sign-in page sends every header and a fresh nonce per request", async ({
    request,
  }) => {
    const first = await request.get("/login");
    const second = await request.get("/login");
    expect(first.status()).toBe(200);
    expectConstantHeaders(first);
    const csp = first.headers()["content-security-policy"];
    expectStrictPolicy(csp);

    const firstNonce = scriptNonce(csp ?? "");
    const secondNonce = scriptNonce(
      second.headers()["content-security-policy"] ?? "",
    );
    expect(firstNonce).toBeDefined();
    expect(secondNonce).not.toBe(firstNonce);
    // Next.js put the same nonce on its own scripts.
    expect(await first.text()).toContain(`nonce="${firstNonce}"`);
  });

  test("redirect and static files carry the headers", async ({ request }) => {
    const redirect = await request.get("/today", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expectConstantHeaders(redirect);
    expectStrictPolicy(redirect.headers()["content-security-policy"]);

    const icon = await request.get("/favicon.ico");
    expect(icon.status()).toBe(200);
    expectConstantHeaders(icon);
  });

  test("403 page carries the headers and its style passes the CSP", async ({
    page,
    consoleErrors,
  }) => {
    const violations = await watchViolations(page);
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    const response = await page.goto("/reports");
    if (!response) throw new Error("no response for /reports");
    expect(response.status()).toBe(403);
    expectConstantHeaders(response);
    expectStrictPolicy(response.headers()["content-security-policy"]);
    await expect(
      page.getByRole("heading", { name: ru.forbidden.title }),
    ).toBeVisible();
    expect(await violations()).toEqual([]);
    // The browser logs the 403 document itself; nothing else may fail.
    expect(
      consoleErrors.filter((text) => !text.includes("status of 403")),
    ).toEqual([]);
  });

  test("main screens render and hydrate with no CSP violation", async ({
    page,
    consoleErrors,
  }) => {
    const violations = await watchViolations(page);

    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: ru.auth.login.submit }),
    ).toBeVisible();
    expect(await violations()).toEqual([]);

    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    for (const path of [
      "/today",
      "/clients",
      "/groups",
      "/reports",
      "/settings",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      expectStrictPolicy(response?.headers()["content-security-policy"]);
      await expect(page.getByRole("main")).toBeVisible();
      expect(await violations(), path).toEqual([]);
    }

    // A client-side navigation needs the hydrated app: blocked scripts would leave it inert.
    await page.goto("/today");
    await page
      .getByRole("navigation", { name: ru.nav.label })
      .first()
      .getByRole("link", { name: ru.nav.clients })
      .click();
    await expect(page).toHaveURL(/\/clients$/);
    expect(await violations()).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
