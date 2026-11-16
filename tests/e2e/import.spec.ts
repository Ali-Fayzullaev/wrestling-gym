import { randomInt } from "node:crypto";

import { fmt, plural } from "@/i18n/format";
import { ru } from "@/i18n/ru";

import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { csvText } from "../support/sheets";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

const importText = { ...ru.importUpload, ...ru.import };

const t = importText;
const HEADERS = ["Фамилия", "Имя", "Телефон", "Группа", "Дата окончания"];

type Supabase = Parameters<typeof serviceClient>[0];

/** Unique Cyrillic surname: letters only, so search treats it as one word. */
function surname(): string {
  const letters = "абвгдежзиклмнопрстуф";
  return `Импорт${Array.from({ length: 6 }, () => letters[randomInt(letters.length)]).join("")}`;
}

/** Fictional phones outside the seed range and outside testPhone() (+7700000 9xxx). */
const phone = () => `+7704${String(randomInt(1e7)).padStart(7, "0")}`;

/** dd.mm.yyyy `days` from today in Asia/Almaty, as people write it in the notebook. */
function notebookDate(days: number): string {
  const today = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const date = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + days,
    ),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** Imported clients have an opening balance and cannot be deleted, so they are archived. */
async function archiveByPhones(supabase: Supabase, phones: string[]) {
  await serviceClient(supabase)
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .in("phone", phones);
}

test.describe("import from the notebook", () => {
  test("criterion 6: upload, preview with errors, import, clients listed with statuses from the file", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    // A throwaway owner: the import limit counts per employee, and runs repeat.
    const owner = await createTempStaff(supabase, "owner");
    const lastName = surname();
    const phones = [phone(), phone(), phone()];
    const csv = csvText([
      HEADERS,
      [`${lastName}`, "Активный", phones[0] ?? "", "", notebookDate(30)],
      [`${lastName}`, "Скорый", phones[1] ?? "", "", notebookDate(3)],
      [`${lastName}`, "Должник", phones[2] ?? "", "", notebookDate(-5)],
      [`${lastName}`, "Ошибочный", "12345", "", ""],
    ]);
    try {
      await loginAs(page, owner.email, owner.password);
      await page.goto("/clients");
      await page.getByRole("link", { name: t.open, exact: true }).click();
      await expect(page).toHaveURL(/\/clients\/import$/);
      await expect(page.getByRole("heading", { name: t.title })).toBeVisible();

      await page.getByTestId("import-file").setInputFiles({
        name: "тетрадь.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(`﻿${csv}`, "utf8"),
      });

      await expect(page.getByTestId("import-count-new")).toHaveText("3");
      await expect(page.getByTestId("import-count-duplicate")).toHaveText("0");
      await expect(page.getByTestId("import-count-error")).toHaveText("1");
      // Rows with errors are shown first, with the reason next to the row.
      const errorRow = page
        .getByTestId("import-row")
        .filter({ hasText: "Ошибочный" });
      await expect(errorRow).toContainText(t.row.errors.phone_invalid);
      await page
        .getByRole("button", { name: new RegExp(`^${t.filter.all}`) })
        .click();
      await expect(page.getByTestId("import-row")).toHaveCount(4);

      await page.getByTestId("import-submit").click();
      const report = page.getByTestId("import-report");
      await expect(report).toContainText(fmt(t.report.created, { count: 3 }));
      await expect(report).toContainText(plural("ru", t.report.skipped, 1));
      await expect(
        report.getByRole("button", { name: t.report.download }),
      ).toBeVisible();

      await report.getByRole("link", { name: t.report.toClients }).click();
      await expect(page).toHaveURL(/\/clients$/);
      await page
        .getByRole("searchbox", { name: ru.clientsList.search })
        .fill(lastName);
      const rows = page.getByTestId("client-row").filter({ hasText: lastName });
      await expect(rows).toHaveCount(3);
      const status = (firstName: string) =>
        rows
          .filter({ hasText: firstName })
          .locator("[data-slot=status-badge]")
          .filter({ visible: true });
      await expect(status("Активный")).toHaveText(ru.status.active);
      await expect(status("Скорый")).toHaveText(ru.status.expiring);
      await expect(status("Должник")).toHaveText(ru.status.expired);
      expect(consoleErrors).toEqual([]);
    } finally {
      await archiveByPhones(supabase, phones);
    }
  });

  test("an unreadable file is explained and nothing is imported", async ({
    page,
    supabase,
  }) => {
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);
    await page.goto("/clients/import");
    await page.getByTestId("import-file").setInputFiles({
      name: "old.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    });
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      t.errors.old_excel,
    );
    await expect(page.getByTestId("import-submit")).toHaveCount(0);
  });

  test("an admin has no import: no button, and the page is refused", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/clients");
    await expect(
      page.getByRole("heading", { name: ru.pages.clients }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: t.open, exact: true }),
    ).toHaveCount(0);
    const response = await page.goto("/clients/import");
    expect(response?.status()).toBe(403);
    const template = await page.request.get("/clients/import/template");
    expect(template.status()).toBe(403);
  });

  test("the owner downloads the template", async ({ page, supabase }) => {
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);
    await page.goto("/clients/import");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: t.file.template }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(t.template.fileName);
  });
});
