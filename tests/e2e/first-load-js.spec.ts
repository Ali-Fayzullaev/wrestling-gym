import { mkdir, writeFile } from "node:fs/promises";

import type { Page, Response } from "@playwright/test";

import { SEED_EMAILS, SEED_PASSWORD } from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

// CLAUDE.md budget: first-load JS per route <= 150 KB gzip on mobile 4G.
const BUDGET_BYTES = 150 * 1024;
const PUBLIC_ROUTES = ["/login"];
const STAFF_ROUTES = [
  "/today",
  "/clients",
  "/more",
  "/groups",
  "/reminders",
  "/reminders?tab=history",
  // A group screen: the member list and the transfer island.
  "/groups/10000000-0000-4000-8000-000000000001",
  // Client form, card (actions island) and edit form.
  "/clients/new",
  "/clients/20000000-0000-4000-8000-000000000001",
  "/clients/20000000-0000-4000-8000-000000000001/edit",
];
/** Owner-only screens, measured with the owner's session. */
const OWNER_ROUTES = ["/settings/reminders", "/clients/import", "/reports"];
const REPORT_DIR = ".perf";

type Row = {
  route: string;
  bytes: number;
  files: number;
  /** Chunks of other routes that next/link prefetches once the page is idle. */
  prefetchedBytes: number;
};

/**
 * Script bytes a cold browser downloads to open `route`: everything up to the load event. What
 * arrives later is link prefetching for the next screen, reported apart and not budgeted here.
 */
async function measure(page: Page, route: string): Promise<Row> {
  const scripts: { size: Promise<number>; beforeLoad: boolean }[] = [];
  let loaded = false;
  const onResponse = (response: Response) => {
    if (response.request().resourceType() !== "script") return;
    scripts.push({
      size: response
        .request()
        .sizes()
        .then((sizes) => sizes.responseBodySize),
      beforeLoad: !loaded,
    });
  };
  page.on("response", onResponse);
  await page.goto(route, { waitUntil: "load" });
  loaded = true;
  await page.waitForLoadState("networkidle");
  page.off("response", onResponse);

  const sizes = await Promise.all(
    scripts.map(async ({ size, beforeLoad }) => ({
      bytes: await size,
      beforeLoad,
    })),
  );
  const sum = (list: { bytes: number }[]) =>
    list.reduce((total, script) => total + script.bytes, 0);
  const firstLoad = sizes.filter((script) => script.beforeLoad);
  return {
    route,
    bytes: sum(firstLoad),
    files: firstLoad.length,
    prefetchedBytes: sum(sizes.filter((script) => !script.beforeLoad)),
  };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

// next build in Next 16 no longer prints First Load JS, so measure what the browser really downloads.
test("first-load JS stays within budget", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "JS bundle is the same for every viewport",
  );
  // A cold browser context per route plus two sign-ins: well past the default 30 s per test.
  test.setTimeout(90_000);

  const rows: Row[] = [];
  for (const route of PUBLIC_ROUTES) rows.push(await measure(page, route));

  await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
  const session = await page.context().storageState();
  for (const route of STAFF_ROUTES) {
    // A new context per route: empty HTTP cache, same signed-in session.
    const context = await browser.newContext({ storageState: session });
    rows.push(await measure(await context.newPage(), route));
    await context.close();
  }

  // Its own sign-in rate-limit bucket, like every test page gets from the fixture.
  const ownerLogin = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "198.18.255.1" },
  });
  const ownerPage = await ownerLogin.newPage();
  await loginAs(ownerPage, SEED_EMAILS.owner, SEED_PASSWORD);
  const ownerSession = await ownerLogin.storageState();
  await ownerLogin.close();
  for (const route of OWNER_ROUTES) {
    const context = await browser.newContext({ storageState: ownerSession });
    rows.push(await measure(await context.newPage(), route));
    await context.close();
  }

  await mkdir(REPORT_DIR, { recursive: true });
  const table = [
    "| Route | First-load JS (gzip, transferred) | Files | Prefetched after load |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.route} | ${kb(row.bytes)} | ${row.files} | ${kb(row.prefetchedBytes)} |`,
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
