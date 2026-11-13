import { mkdir, writeFile } from "node:fs/promises";

import type { Response } from "@playwright/test";

import { expect, test } from "./fixtures";

// CLAUDE.md budget: first-load JS per route <= 150 KB gzip on mobile 4G.
const BUDGET_BYTES = 150 * 1024;
const ROUTES = ["/login"];
const REPORT_DIR = ".perf";

// next build in Next 16 no longer prints First Load JS, so measure what the browser really downloads.
test("first-load JS stays within budget", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "JS bundle is the same for every viewport",
  );

  const rows: { route: string; bytes: number; files: number }[] = [];

  for (const route of ROUTES) {
    const scriptSizes: Promise<number>[] = [];
    const onResponse = (response: Response) => {
      if (response.request().resourceType() === "script") {
        scriptSizes.push(
          response
            .request()
            .sizes()
            .then((sizes) => sizes.responseBodySize),
        );
      }
    };
    page.on("response", onResponse);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    page.off("response", onResponse);

    const sizes = await Promise.all(scriptSizes);
    rows.push({
      route,
      bytes: sizes.reduce((sum, size) => sum + size, 0),
      files: sizes.length,
    });
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const table = [
    "| Route | First-load JS (gzip, transferred) | Files |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.route} | ${(row.bytes / 1024).toFixed(1)} KB | ${row.files} |`,
    ),
  ].join("\n");
  await writeFile(`${REPORT_DIR}/first-load-js.md`, `${table}\n`);
  await testInfo.attach("first-load-js", {
    body: table,
    contentType: "text/markdown",
  });

  for (const row of rows) {
    expect(row.files, `no scripts captured for ${row.route}`).toBeGreaterThan(
      0,
    );
    expect(row.bytes, `first-load JS of ${row.route}`).toBeLessThanOrEqual(
      BUDGET_BYTES,
    );
  }
});
