import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { auditText } from "@/i18n/audit";
import { ru } from "@/i18n/ru";
import { settingsText, staffText } from "@/i18n/settings";

import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { formAlert, loginAs, submitLogin } from "./support/auth";

const SERVER_ROUND_TRIP = { timeout: 10_000 };
// Auth hashes the password (bcrypt) before answering; under a full parallel run that takes seconds.
const AUTH_ROUND_TRIP = { timeout: 30_000 };

test.describe("staff", () => {
  test("criterion 1: the owner adds an employee with a temporary password; the employee must replace it first", async ({
    page,
    browser,
    supabase,
    consoleErrors,
  }) => {
    // Three sign-ins and three Auth password writes: longer than the default test time under load.
    test.slow();
    // A throwaway owner: the seed owner's access stays as it is for parallel tests.
    const owner = await createTempStaff(supabase, "owner");
    const email = `added-${randomUUID()}@example.test`;
    const name = `Добавленный ${randomUUID().slice(0, 6)}`;
    const temporary = `temp-${randomUUID().slice(0, 8)}`;
    await loginAs(page, owner.email, owner.password);

    await page.goto("/settings");
    await page.getByRole("link", { name: settingsText.staff.open }).click();
    await expect(page).toHaveURL(/\/settings\/staff$/);

    await page.getByLabel(staffText.add.email).fill(email);
    await page.getByLabel(staffText.add.fullName).fill(name);
    await page
      .getByLabel(staffText.add.role, { exact: true })
      .selectOption("admin");
    await page.getByLabel(staffText.add.password).fill(temporary);
    await page.getByRole("button", { name: staffText.add.submit }).click();
    await expect(page.getByTestId("add-staff-status")).toHaveText(
      staffText.add.added,
      AUTH_ROUND_TRIP,
    );
    // The password does not stay on the screen after it is saved.
    await expect(page.getByLabel(staffText.add.password)).toHaveValue("");
    expect(page.url()).not.toContain(temporary);

    const row = page.getByTestId("staff-row").filter({ hasText: email });
    await expect(row).toContainText(name);
    await expect(row.getByTestId("staff-role")).toHaveText(ru.roles.admin);
    await expect(row.getByTestId("staff-temporary-password")).toHaveText(
      staffText.list.mustChangePassword,
    );

    // The employee signs in on their own phone and is kept on the password form.
    const employee = await browser.newContext();
    const employeePage = await employee.newPage();
    await employeePage.goto("/login");
    await submitLogin(employeePage, email, temporary);
    await expect(employeePage).toHaveURL(/\/update-password$/);
    await expect(
      employeePage.getByRole("heading", {
        level: 1,
        name: ru.auth.update.requiredTitle,
      }),
    ).toBeVisible();
    for (const path of ["/today", "/clients", "/settings/staff"]) {
      await employeePage.goto(path);
      await expect(employeePage, path).toHaveURL(/\/update-password$/);
    }
    const own = `own-${randomUUID().slice(0, 8)}`;
    await employeePage.getByLabel(ru.auth.update.password).fill(own);
    await employeePage.getByLabel(ru.auth.update.confirm).fill(own);
    await employeePage
      .getByRole("button", { name: ru.auth.update.submit })
      .click();
    await expect(employeePage).toHaveURL(/\/today$/, AUTH_ROUND_TRIP);
    await employee.close();

    await page.reload();
    await expect(row.getByTestId("staff-temporary-password")).toHaveCount(0);

    // Forgotten password: the owner sets a new temporary one.
    const reset = `reset-${randomUUID().slice(0, 8)}`;
    await row
      .getByRole("button", { name: staffText.list.resetPassword })
      .click();
    const dialog = page.getByRole("dialog").filter({ visible: true });
    await expect(dialog).toContainText(staffText.reset.title(name));
    await dialog.getByLabel(staffText.reset.password).fill(reset);
    await dialog.getByRole("button", { name: staffText.reset.submit }).click();
    await expect(row).toContainText(staffText.reset.done, AUTH_ROUND_TRIP);
    await expect(row.getByTestId("staff-temporary-password")).toHaveText(
      staffText.list.mustChangePassword,
    );

    const again = await browser.newContext();
    const againPage = await again.newPage();
    await againPage.goto("/login");
    await submitLogin(againPage, email, own);
    await expect(formAlert(againPage)).toHaveText(
      ru.auth.login.invalidCredentials,
    );
    await submitLogin(againPage, email, reset);
    await expect(againPage).toHaveURL(/\/update-password$/);
    await again.close();

    await row.getByRole("button", { name: staffText.list.makeOwner }).click();
    await expect(row.getByTestId("staff-role")).toHaveText(
      ru.roles.owner,
      SERVER_ROUND_TRIP,
    );

    await row.getByRole("button", { name: staffText.list.deactivate }).click();
    const confirm = page.getByRole("dialog").filter({ visible: true });
    await expect(confirm).toContainText(staffText.list.deactivateTitle(name));
    await confirm
      .getByRole("button", { name: staffText.list.deactivate })
      .click();
    await expect(row.getByTestId("staff-inactive")).toHaveText(
      staffText.list.inactive,
      SERVER_ROUND_TRIP,
    );
    await expect(
      row.getByRole("button", { name: staffText.list.activate }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: staffText.list.resetPassword }),
    ).toHaveCount(0);

    // The owner's own row offers no buttons: another owner changes it.
    const self = page.getByTestId("staff-row").filter({ hasText: owner.email });
    await expect(self).toContainText(staffText.list.selfNote);
    await expect(self.getByRole("button")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });

  test("criterion 3: an admin cannot open the staff screen or call its actions", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    const response = await page.goto("/settings/staff");
    expect(response?.status()).toBe(403);
    await expect(page.getByLabel(staffText.add.password)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: staffText.list.resetPassword }),
    ).toHaveCount(0);
  });
});

test.describe("the More screen by role", () => {
  test("criterion 6: an admin's More has no reports, journal, settings or staff", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/more");
    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: ru.nav.reminders }),
    ).toBeVisible();
    for (const name of [
      ru.nav.reports,
      ru.nav.audit,
      ru.nav.settings,
      ru.pages.staff,
      ru.pages.clientImport,
    ]) {
      await expect(main.getByRole("link", { name })).toHaveCount(0);
    }
    await expect(
      main.getByRole("button", { name: ru.auth.logout }),
    ).toBeVisible();
    await expect(main.getByText(ru.theme.label)).toBeVisible();
  });

  test("the owner's More leads to reports, journal and settings", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.goto("/more");
    const main = page.getByRole("main");
    for (const name of [ru.nav.reports, ru.nav.audit, ru.nav.settings]) {
      await expect(main.getByRole("link", { name })).toBeVisible();
    }
    await main.getByRole("link", { name: ru.nav.settings }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.settings }),
    ).toBeVisible();
  });
});

test.describe("journal", () => {
  test("the owner reads an export and a sign-in in plain words and filters by action", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    // A throwaway owner, so the filter by employee shows only this test's entries.
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);
    const exported = await page.request.get(
      "/reports/export?data=clients&format=csv",
    );
    expect(exported.status()).toBe(200);

    await page.goto(`/audit?staff=${owner.id}`);
    const entries = page.getByTestId("audit-entry");
    await expect(entries).toHaveCount(2);
    const exportEntry = entries.filter({
      hasText: auditText.actions["report.export"],
    });
    await expect(exportEntry.getByTestId("audit-details")).toContainText(
      `${auditText.exportClients} · CSV · `,
    );
    await expect(exportEntry.getByTestId("audit-actor")).toHaveText(
      "Тестовый сотрудник",
    );
    await expect(
      entries.filter({ hasText: auditText.actions["staff.login"] }),
    ).toHaveCount(1);

    // The filter is a plain form: choosing an action and submitting changes the address.
    await page
      .getByLabel(auditText.filters.action)
      .selectOption("report.export");
    await page.getByRole("button", { name: auditText.filters.apply }).click();
    await expect(page).toHaveURL(/action=report\.export/);
    await expect(entries).toHaveCount(1);
    await expect(entries.getByTestId("audit-title")).toHaveText(
      auditText.actions["report.export"],
    );

    await page.getByRole("link", { name: auditText.filters.reset }).click();
    await expect(page).toHaveURL(/\/audit$/);
    expect(consoleErrors).toEqual([]);
  });

  test("a malformed address shows the unfiltered journal and says so", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.goto("/audit?staff=not-a-uuid");
    await expect(page.getByText(auditText.filters.invalid)).toBeVisible();
    await expect(page.getByTestId("audit-entry").first()).toBeVisible();
  });
});

test.describe("secrets", () => {
  test("criterion 7: the service_role key is not in the browser bundle", async ({
    supabase,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "the bundle is the same for every viewport",
    );
    const files: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else files.push(path);
      }
    }
    await walk(".next/static");
    expect(files.length).toBeGreaterThan(0);
    const needles = [
      supabase.secretKey,
      "service_role",
      "SUPABASE_SECRET_KEY",
      "sb_secret_",
    ];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const needle of needles) {
        expect(text.includes(needle), `${needle} in ${file}`).toBe(false);
      }
    }
  });
});
