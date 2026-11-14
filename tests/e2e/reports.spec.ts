import { readFile } from "node:fs/promises";

import type { Download } from "@playwright/test";

import { readXlsx } from "@/features/import/xlsx";
import {
  currentMonth,
  formatMonth,
  shiftMonth,
} from "@/features/reports/month";
import { reportsText as t } from "@/i18n/reports";
import { ru } from "@/i18n/ru";

import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

async function downloadBytes(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  return new Uint8Array(await readFile(path));
}

test.describe("reports", () => {
  test("criterion 5: the owner switches months and downloads xlsx and csv with headers", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    // A throwaway owner: exports are limited per employee per hour, and runs repeat.
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);

    const month = currentMonth(new Date());
    const previous = shiftMonth(month, -1);
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: ru.pages.reports, level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId("report-month")).toHaveText(
      formatMonth(month),
    );
    // The seeds hold payments this month, split by method and group.
    await expect(
      page.getByTestId("report-by-method").getByTestId("bar-row"),
    ).toHaveCount(3);
    await expect(
      page.getByRole("heading", { name: t.debtors.title }),
    ).toBeVisible();
    // No month after the current one.
    await expect(page.getByRole("link", { name: t.monthNav.next })).toHaveCount(
      0,
    );

    await page.getByRole("link", { name: t.monthNav.previous }).click();
    await expect(page).toHaveURL(new RegExp(`/reports\\?month=${previous}$`));
    await expect(page.getByTestId("report-month")).toHaveText(
      formatMonth(previous),
    );
    await page.getByRole("link", { name: t.monthNav.next }).click();
    await expect(page).toHaveURL(new RegExp(`/reports\\?month=${month}$`));
    await expect(page.getByTestId("report-month")).toHaveText(
      formatMonth(month),
    );

    // Debtors open a group to show who, linked to the client card.
    const group = page.getByTestId("debtor-group").first();
    await group.locator("summary").click();
    await expect(group.getByRole("link").first()).toHaveAttribute(
      "href",
      /^\/clients\/[0-9a-f-]{36}$/,
    );

    const xlsxDownload = page.waitForEvent("download");
    await page.getByTestId("export-payments-xlsx").click();
    const xlsx = await xlsxDownload;
    expect(xlsx.suggestedFilename()).toBe(`payments-${month}.xlsx`);
    const sheet = readXlsx(await downloadBytes(xlsx));
    expect(sheet[0]).toEqual([...t.file.paymentsHeader]);
    expect(sheet.length).toBeGreaterThan(1);

    const csvDownload = page.waitForEvent("download");
    await page.getByTestId("export-clients-csv").click();
    const csv = await csvDownload;
    expect(csv.suggestedFilename()).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await downloadBytes(csv),
    );
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.slice(1).split("\r\n")[0]).toBe(t.file.clientsHeader.join(";"));

    const clientsXlsx = page.waitForEvent("download");
    await page.getByTestId("export-clients-xlsx").click();
    const clientsSheet = readXlsx(await downloadBytes(await clientsXlsx));
    expect(clientsSheet[0]).toEqual([...t.file.clientsHeader]);

    const paymentsCsv = page.waitForEvent("download");
    await page.getByTestId("export-payments-csv").click();
    expect((await paymentsCsv).suggestedFilename()).toBe(
      `payments-${month}.csv`,
    );

    expect(consoleErrors).toEqual([]);
  });

  test("a malformed export request is refused", async ({ page, supabase }) => {
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);
    const response = await page.request.get(
      "/reports/export?data=payments&format=xlsx",
    );
    expect(response.status()).toBe(400);
    expect(await response.text()).toBe(t.errors.invalid);
  });

  test("criterion 3: an admin is refused the screen and the export with 403", async ({
    page,
  }) => {
    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    const screen = await page.goto("/reports");
    expect(screen?.status()).toBe(403);
    for (const query of [
      "data=payments&format=xlsx&month=2026-11",
      "data=clients&format=csv",
    ]) {
      const response = await page.request.get(`/reports/export?${query}`);
      expect(response.status()).toBe(403);
      expect(response.headers()["content-disposition"]).toBeUndefined();
    }
  });

  test("a guest is sent to sign-in instead of getting a file", async ({
    page,
  }) => {
    const response = await page.request.get(
      "/reports/export?data=clients&format=csv",
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/login\?next=/);
  });
});
