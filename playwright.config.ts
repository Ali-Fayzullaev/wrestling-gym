import { defineConfig, devices } from "@playwright/test";

import { readLocalSupabase } from "./tests/support/local-supabase";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// `pnpm check` builds once before e2e and sets E2E_PREBUILT to skip a second build.
const serverCommand = process.env.E2E_PREBUILT
  ? `pnpm start --port ${PORT}`
  : `pnpm build && pnpm start --port ${PORT}`;

// Read once in the main process; workers inherit the values through the environment.
if (!process.env.E2E_SUPABASE_URL) {
  const local = readLocalSupabase();
  process.env.E2E_SUPABASE_URL = local.apiUrl;
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY = local.publishableKey;
  process.env.E2E_SUPABASE_SECRET_KEY = local.secretKey;
}

const PHONE = {
  ...devices["Desktop Chrome"],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};
const GLOBAL_SETTINGS_SPEC = /settings-global\.spec\.ts$/;
const ACCEPTANCE_SPEC = /acceptance\.spec\.ts$/;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ru-RU",
    timezoneId: "Asia/Almaty",
  },
  projects: [
    {
      name: "mobile",
      testIgnore: [GLOBAL_SETTINGS_SPEC, ACCEPTANCE_SPEC],
      use: PHONE,
    },
    {
      name: "desktop",
      testIgnore: [GLOBAL_SETTINGS_SPEC, ACCEPTANCE_SPEC],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    // Changes gym-wide settings other tests read (name, reminder days): runs alone, afterwards.
    {
      name: "global-settings",
      testMatch: GLOBAL_SETTINGS_SPEC,
      dependencies: ["mobile", "desktop"],
      use: PHONE,
    },
    // Stopwatch criteria of the acceptance: timed on an otherwise idle server, so it runs last.
    {
      name: "acceptance",
      testMatch: ACCEPTANCE_SPEC,
      dependencies: ["global-settings"],
      use: PHONE,
    },
  ],
  webServer: {
    command: serverCommand,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    // Server-only variables, read at request time; the build itself needs none of them.
    env: {
      SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "",
      SUPABASE_PUBLISHABLE_KEY: process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "",
      SUPABASE_SECRET_KEY: process.env.E2E_SUPABASE_SECRET_KEY ?? "",
      // The component showcase (/dev/ui) is off in production builds unless asked for.
      ENABLE_DEV_UI: "1",
    },
  },
});
