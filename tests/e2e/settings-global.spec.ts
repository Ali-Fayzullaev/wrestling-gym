import { randomUUID } from "node:crypto";

import { plural } from "@/i18n/format";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/lib/format";

import { createTempStaff, serviceClient } from "../support/staff-accounts";
import { expect, test } from "./fixtures";
import { loginAs } from "./support/auth";

const groupsText = ru.groups;
const paymentsText = ru.payments;
const remindersText = ru.reminders;
const settingsText = ru.settings;

/**
 * Criterion 8. Changes the gym-wide settings (name, reminder days) that other tests read, so this
 * file runs in its own Playwright project after the others (playwright.config.ts) and puts the
 * values back. The group and client are its own.
 */

const SERVER_ROUND_TRIP = { timeout: 10_000 };
const SEED_ADMIN = "00000000-0000-4000-8000-000000000002";
const SEED_OWNER = "00000000-0000-4000-8000-000000000001";

test("criterion 8: from Settings the owner changes the gym name, a group price and reminder days; the screens show them", async ({
  page,
  supabase,
  consoleErrors,
}) => {
  const service = serviceClient(supabase);
  const tag = randomUUID().slice(0, 6);
  const groupName = `Настройки ${tag}`;
  const gymName = `Зал Барыс ${tag}`;
  const groupId = randomUUID();
  const clientId = randomUUID();

  const { data: before, error } = await service
    .from("settings")
    .select("gym_name, gym_whatsapp, reminder_days")
    .single();
  if (error) throw new Error(`settings read failed: ${error.code}`);
  const firstDays = [...before.reminder_days].sort((a, b) => b - a)[0] ?? 7;
  const newFirstDays = firstDays === 9 ? 10 : 9;

  await service.from("groups").insert({
    id: groupId,
    name: groupName,
    coach_id: SEED_ADMIN,
    schedule: [{ day: 4, start: "17:00", end: "18:00" }],
    default_price: 15000,
  });
  await service.from("clients").insert({
    id: clientId,
    last_name: `Ценов${tag.replace(/\d/g, "")}`,
    first_name: "Настроек",
    phone: `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    phone_owner: "self",
    group_id: groupId,
    started_on: "2026-11-01",
    created_by: SEED_OWNER,
  });

  try {
    const owner = await createTempStaff(supabase, "owner");
    await loginAs(page, owner.email, owner.password);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { level: 1, name: ru.pages.settings }),
    ).toBeVisible();

    // Gym: one button, a plain confirmation.
    const gym = page.getByRole("form", { name: settingsText.gym.title });
    await gym.getByLabel(settingsText.gym.name).fill(gymName);
    await gym.getByLabel(settingsText.gym.whatsapp).fill("8 701 555 44 33");
    await gym.getByRole("button", { name: settingsText.gym.save }).click();
    await expect(page.getByTestId("gym-settings-status")).toHaveText(
      settingsText.gym.saved,
      SERVER_ROUND_TRIP,
    );

    // Group price through the same form as on the group screen.
    const row = page
      .getByTestId("settings-group")
      .filter({ hasText: groupName });
    await row.getByRole("button", { name: groupsText.edit }).click();
    const dialog = page.getByRole("dialog").filter({ visible: true });
    await dialog.getByLabel(groupsText.form.price).fill("23 000");
    await dialog.getByRole("button", { name: groupsText.form.save }).click();
    await expect(row.getByTestId("settings-group-price")).toHaveText(
      formatMoney(23000, "ru"),
      SERVER_ROUND_TRIP,
    );

    // Reminder days on the reminders settings screen reached from Settings.
    await page.getByRole("link", { name: settingsText.reminders.open }).click();
    await expect(page).toHaveURL(/\/settings\/reminders$/);
    await page
      .getByLabel(remindersText.settings.firstDays)
      .fill(String(newFirstDays));
    await page
      .getByRole("button", { name: remindersText.settings.save })
      .click();
    await expect(page.getByTestId("settings-status")).toHaveText(
      remindersText.settings.saved,
      SERVER_ROUND_TRIP,
    );

    // Visible elsewhere: the group screen, the payment dialog, the reminder texts and Settings.
    await page.goto(`/groups/${groupId}`);
    await expect(page.getByRole("main")).toContainText(
      formatMoney(23000, "ru"),
    );

    await page.goto(`/clients/${clientId}`);
    await page.getByTestId("pay-button").click();
    await expect(
      page
        .getByRole("dialog")
        .filter({ visible: true })
        .getByLabel(paymentsText.dialog.amount),
    ).toHaveValue("23000");

    await page.goto("/settings/reminders");
    await expect(
      page
        .getByTestId("template-before_7")
        .getByText(plural("ru", remindersText.kinds.first, newFirstDays)),
    ).toBeVisible();
    await expect(
      page.getByTestId("template-overdue").getByTestId("template-preview"),
    ).toContainText(gymName);

    await page.goto("/settings");
    await expect(page.getByTestId("settings-reminders-status")).toContainText(
      plural("ru", settingsText.daysWord, newFirstDays),
    );
    await expect(
      page
        .getByRole("form", { name: settingsText.gym.title })
        .getByLabel(settingsText.gym.whatsapp),
    ).toHaveValue("+77015554433");
    expect(consoleErrors).toEqual([]);
  } finally {
    await service
      .from("settings")
      .update({
        gym_name: before.gym_name,
        gym_whatsapp: before.gym_whatsapp,
        reminder_days: before.reminder_days,
      })
      .eq("id", true);
    await service
      .from("clients")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", clientId);
    await service
      .from("groups")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", groupId);
  }
});
