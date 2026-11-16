import { randomUUID } from "node:crypto";

import type { Page, Request } from "@playwright/test";

import { defined } from "../support/defined";
import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";
import { fmt } from "@/i18n/format";
import { ru } from "@/i18n/ru";

const groupsText = ru.groups;

const g = groupsText;
const SEED_GROUP = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const COACH_NAME = "Данияр Примеров";

/** Visible dialog (sheet on a phone, dialog on a computer). */
function dialog(page: Page) {
  return page.getByRole("dialog").filter({ visible: true });
}

function card(page: Page, name: string) {
  return page
    .getByTestId("group-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
}

/** Fills the group form; times only for the days given. */
async function fillGroupForm(
  page: Page,
  values: { name: string; price: string; capacity: string },
) {
  const form = dialog(page);
  await form.getByLabel(g.form.name).fill(values.name);
  await form.getByLabel(g.form.coach).selectOption({ label: COACH_NAME });
  await form.getByRole("checkbox", { name: g.daysLong[0] }).check();
  await form.getByLabel(`${g.daysLong[0]}, ${g.form.from}`).fill("18:00");
  await form.getByLabel(`${g.daysLong[0]}, ${g.form.to}`).fill("19:30");
  await form.getByLabel(g.form.price).fill(values.price);
  await form.getByLabel(g.form.capacity).fill(values.capacity);
}

/**
 * The body React sends for createGroupAction(formData): the FormData fields prefixed with "_1_"
 * and the argument list pointing at them.
 */
function createGroupBody(contentType: string, name: string): Buffer {
  const boundary = defined(contentType.split("boundary=")[1]);
  const fields: Record<string, string> = {
    name,
    coachId: OWNER_ID,
    defaultPrice: "15000",
    capacity: "",
  };
  const parts = Object.entries(fields).map(
    ([key, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="_1_${key}"\r\n\r\n${value}\r\n`,
  );
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${boundary}--\r\n`,
  );
  return Buffer.from(parts.join(""));
}

test.describe("owner", () => {
  test("criterion 5: create a group, see it, rename it, archive it", async ({
    page,
    consoleErrors,
  }) => {
    const name = `Е2Е ${randomUUID().slice(0, 8)}`;
    await loginAs(page, SEED_EMAILS.owner, SEED_PASSWORD);
    await page.goto("/groups");

    await page.getByRole("button", { name: g.create }).click();
    await expect(dialog(page)).toBeVisible();
    // A wrong price stays in the form with a message next to the field.
    await fillGroupForm(page, { name, price: "-5", capacity: "20" });
    await dialog(page).getByRole("button", { name: g.form.save }).click();
    await expect(
      dialog(page).getByText(g.form.errors.defaultPrice),
    ).toBeVisible();
    await expect(dialog(page).getByLabel(g.form.name)).toHaveValue(name);

    await dialog(page).getByLabel(g.form.price).fill("15 000");
    await dialog(page).getByRole("button", { name: g.form.save }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText(g.form.created)).toBeVisible();
    await expect(card(page, name)).toBeVisible();
    await expect(card(page, name)).toContainText("Пн 18:00–19:30");
    await expect(card(page, name).getByTestId("group-seats")).toHaveText(
      "0 / 20",
    );

    await card(page, name).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByRole("button", { name: g.edit }).click();
    await expect(dialog(page).getByLabel(g.form.name)).toHaveValue(name);
    await expect(dialog(page).getByText(g.form.priceHint)).toBeVisible();
    await dialog(page).getByLabel(g.form.name).fill(`${name} новая`);
    await dialog(page).getByRole("button", { name: g.form.save }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `${name} новая` }),
    ).toBeVisible();

    await page.getByRole("button", { name: g.archive }).click();
    await expect(dialog(page).getByText(g.archiveDialog.title)).toBeVisible();
    await dialog(page)
      .getByRole("button", { name: g.archiveDialog.confirm, exact: true })
      .click();
    await expect(page).toHaveURL(/\/groups$/);
    await expect(page.getByText(g.archiveDialog.done)).toBeVisible();
    await expect(card(page, name)).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("admin", () => {
  test("criterion 6: no management buttons, and a replayed owner action is refused", async ({
    page,
    browser,
    supabase,
  }) => {
    // Capture what the owner's browser sends to the "create group" Server Action.
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await loginAs(ownerPage, SEED_EMAILS.owner, SEED_PASSWORD);
    await ownerPage.goto("/groups");
    await ownerPage.getByRole("button", { name: g.create }).click();
    // An empty form: the action refuses it, so nothing is created on the owner's side.
    const captured = new Promise<Request>((resolve) => {
      ownerPage.on("request", (request) => {
        if (request.method() === "POST" && request.headers()["next-action"])
          resolve(request);
      });
    });
    await dialog(ownerPage).getByRole("button", { name: g.form.save }).click();
    const request = await captured;
    const actionId = defined(request.headers()["next-action"]);
    const contentType = defined(request.headers()["content-type"]);
    const callCreate = (context: typeof page.request, name: string) =>
      context.post("/groups", {
        headers: {
          "next-action": actionId,
          "content-type": contentType,
          accept: "text/x-component",
        },
        data: createGroupBody(contentType, name),
        maxRedirects: 0,
      });
    const groupsNamed = async (name: string) =>
      (
        await serviceClient(supabase)
          .from("groups")
          .select("id")
          .eq("name", name)
      ).data ?? [];

    // Control: the hand-built call works for the owner, so a refusal below means the role.
    const controlName = `Контроль ${randomUUID().slice(0, 8)}`;
    expect((await callCreate(ownerContext.request, controlName)).ok()).toBe(
      true,
    );
    const control = await groupsNamed(controlName);
    expect(control).toHaveLength(1);
    await serviceClient(supabase)
      .from("groups")
      .delete()
      .eq("id", defined(control[0]).id);
    await ownerContext.close();

    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto("/groups");
    await expect(card(page, "Взрослые")).toBeVisible();
    await expect(page.getByRole("button", { name: g.create })).toHaveCount(0);
    await page.goto(`/groups/${SEED_GROUP}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: g.edit })).toHaveCount(0);
    await expect(page.getByRole("button", { name: g.archive })).toHaveCount(0);

    // The same action called directly with the admin's session and a valid group.
    const name = `Обход ${randomUUID().slice(0, 8)}`;
    const response = await callCreate(page.request, name);
    expect(response.headers()["x-action-redirect"] ?? "").toContain(
      "/forbidden",
    );
    expect(await groupsNamed(name)).toEqual([]);
  });
});

test.describe("transfer", () => {
  const created: { groups: string[]; clients: string[] } = {
    groups: [],
    clients: [],
  };

  test.afterEach(async ({ supabase }) => {
    const db = serviceClient(supabase);
    if (created.clients.length)
      await db.from("clients").delete().in("id", created.clients);
    if (created.groups.length)
      await db.from("groups").delete().in("id", created.groups);
  });

  test("criterion 7: moving two clients updates both groups' counts", async ({
    page,
    supabase,
    consoleErrors,
  }) => {
    const db = serviceClient(supabase);
    const tag = randomUUID().slice(0, 6);
    const fromName = `Откуда ${tag}`;
    const toName = `Куда ${tag}`;
    const [from, to] = [randomUUID(), randomUUID()];
    created.groups.push(from, to);
    await db.from("groups").insert([
      {
        id: from,
        name: fromName,
        coach_id: OWNER_ID,
        default_price: 15000,
        capacity: 10,
      },
      {
        id: to,
        name: toName,
        coach_id: OWNER_ID,
        default_price: 15000,
        capacity: 2,
      },
    ]);
    const names = ["Первый", "Второй", "Третий"];
    const rows = names.map((firstName, index) => ({
      id: randomUUID(),
      last_name: `Перевод${tag}`,
      first_name: firstName,
      // Fictional, outside the seed range; duplicates are allowed by design.
      phone: `+770000097${index}0`,
      phone_owner: "self",
      group_id: from,
      started_on: "2026-11-01",
      created_by: OWNER_ID,
    }));
    created.clients.push(...rows.map((row) => row.id));
    const { error } = await db.from("clients").insert(rows);
    expect(error).toBeNull();

    await loginAs(page, SEED_EMAILS.admin, SEED_PASSWORD);
    await page.goto(`/groups/${from}`);
    await expect(page.getByTestId("stat-members")).toHaveText("3 / 10");

    await page.getByRole("checkbox", { name: `Перевод${tag} Первый` }).check();
    await page.getByRole("checkbox", { name: `Перевод${tag} Второй` }).check();
    await expect(
      page.getByText(fmt(g.moveDialog.selected, { count: 2 })),
    ).toBeVisible();
    await page.getByRole("button", { name: `${g.move} (2)` }).click();

    await dialog(page)
      .getByRole("radio", { name: new RegExp(toName) })
      .check();
    // 0 + 2 fits the limit of 2: no warning.
    await expect(dialog(page).getByRole("status")).toHaveCount(0);
    await dialog(page)
      .getByRole("button", { name: g.moveDialog.confirm })
      .click();
    await expect(
      page.getByText(fmt(g.moveDialog.done, { count: 2 })),
    ).toBeVisible();
    await expect(page.getByTestId("stat-members")).toHaveText("1 / 10");
    await expect(page.getByTestId("group-member")).toHaveCount(1);

    await page.goto("/groups");
    await expect(card(page, fromName).getByTestId("group-seats")).toHaveText(
      "1 / 10",
    );
    await expect(card(page, toName).getByTestId("group-seats")).toHaveText(
      "2 / 2",
    );

    // Moving the last one into the full group warns but is allowed.
    await page.goto(`/groups/${from}`);
    await page.getByRole("checkbox", { name: g.moveDialog.selectAll }).check();
    await page.getByRole("button", { name: `${g.move} (1)` }).click();
    await dialog(page)
      .getByRole("radio", { name: new RegExp(toName) })
      .check();
    await expect(dialog(page).getByRole("status")).toContainText(
      fmt(g.moveDialog.overWarning, { members: 3, capacity: 2 }),
    );
    await dialog(page)
      .getByRole("button", { name: g.moveDialog.confirm })
      .click();
    await expect(page.getByText(g.membersEmpty)).toBeVisible();
    await page.goto(`/groups/${to}`);
    await expect(page.getByTestId("stat-members")).toHaveText("3 / 2");
    expect(consoleErrors).toEqual([]);
  });
});
