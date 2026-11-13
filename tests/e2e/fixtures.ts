import { randomInt } from "node:crypto";

import { test as base, expect } from "@playwright/test";

import type { LocalSupabase } from "../support/local-supabase";

type Fixtures = {
  /** Console errors and uncaught page errors collected during the test. */
  consoleErrors: string[];
  /** Address the app sees for this test; each test gets its own sign-in rate-limit bucket. */
  clientIp: string;
  supabase: Pick<
    LocalSupabase,
    "apiUrl" | "publishableKey" | "secretKey" | "mailpitUrl"
  >;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set; playwright.config.ts reads it`);
  return value;
}

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    await use(errors);
  },
  clientIp: [
    async ({ page }, use) => {
      const ip = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
      await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await use(ip);
    },
    { auto: true },
  ],
  supabase: async ({}, use) => {
    await use({
      apiUrl: env("E2E_SUPABASE_URL"),
      publishableKey: env("E2E_SUPABASE_PUBLISHABLE_KEY"),
      secretKey: env("E2E_SUPABASE_SECRET_KEY"),
      mailpitUrl: env("E2E_MAILPIT_URL"),
    });
  },
});

export { expect };
