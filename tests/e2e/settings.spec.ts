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
import { latestEmailHtml, loginAs } from "./support/auth";

const SERVER_ROUND_TRIP = { timeout: 10_000 };

test.describe("staff", () => {
  test("criterion 5: the owner invites an employee, changes the role and deactivates", async ({
    page,
    browser,
    supabase,
    consoleErrors,
  }) => {
    // A throwaway owner: the seed owner's access stays as it is for parallel tests.
    const owner = await createTempStaff(supabase, "owner");
    const email = `invited-${randomUUID()}@example.test`;
    const name = `Приглашённый ${randomUUID().slice(0, 6)}`;
    await loginAs(page, owner.email, owner.password);

    await page.goto("/settings");
    await page.getByRole("link", { name: settingsText.staff.open }).click();
    await expect(page).toHaveURL(/\/settings\/staff$/);

    await page.getByLabel(staffText.invite.email).fill(email);
    await page.getByLabel(staffText.invite.fullName).fill(name);
    await page.getByLabel(staffText.invite.role).selectOption("admin");
    await page.getByRole("button", { name: staffText.invite.submit }).click();
    // Auth sends the email before answering; under a full parallel run that takes seconds.
    await expect(page.getByTestId("invite-status")).toHaveText(
      staffText.invite.sent,
      { timeout: 30_000 },
    );

    const row = page.getByTestId("staff-row").filter({ hasText: email });
    await expect(row).toContainText(name);
    await expect(row.getByTestId("staff-role")).toHaveText(ru.roles.admin);
    await expect(row).toContainText(staffText.list.invited);

    // The invitation link opens the new-password form with a session of the invited employee.
    const html = await latestEmailHtml(supabase.mailpitUrl, email);
    const link = /href="([^"]+type=invite)"/.exec(html)?.[1];
    expect(link).toContain("/auth/confirm?token_hash=");
    const invited = await browser.newContext();
    const invitedPage = await invited.newPage();
    await invitedPage.goto(link?.replaceAll("&amp;", "&") ?? "");
    await expect(invitedPage).toHaveURL(/\/update-password$/);
    await invited.close();

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

    // The owner's own row offers no buttons: another owner changes it.
    const own = page.getByTestId("staff-row").filter({ hasText: owner.email });
    await expect(own).toContainText(staffText.list.selfNote);
    await expect(own.getByRole("button")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
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
