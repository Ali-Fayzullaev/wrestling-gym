import { test as base, expect } from "@playwright/test";

type Fixtures = {
  /** Console errors and uncaught page errors collected during the test. */
  consoleErrors: string[];
};

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
});

export { expect };
