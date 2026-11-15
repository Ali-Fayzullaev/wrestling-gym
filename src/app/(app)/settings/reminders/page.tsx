import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { ReminderSettingsForm } from "@/features/reminders/components/reminder-settings-form";
import { getReminderSettings } from "@/features/reminders/service";
import type { ReminderContact } from "@/features/reminders/template";
import { remindersText } from "@/i18n/reminders";
import { ru } from "@/i18n/ru";

import { BackLink } from "@/components/back-link";
import { saveReminderSettingsAction } from "./actions";

export const metadata: Metadata = {
  title: `${ru.pages.reminderSettings} | ${ru.app.name}`,
};

// Only when there is no current client with a group to show the texts on; the screen says so.
const SAMPLE_CONTACT: ReminderContact = {
  firstName: "Азамат",
  phoneOwner: "self",
  parentName: null,
  groupName: "Взрослые",
  price: 20000,
  endsOn: null,
};

/**
 * "Settings -> Reminders" (D-11): days and texts on one screen. Owner only, here and in the
 * proxy. Two database requests: the role check and reminder_settings_screen().
 */
export default async function ReminderSettingsPage() {
  await requireStaff(["owner"]);
  const now = new Date();
  const { context, preview } = await getReminderSettings(
    await createServerDb(),
    now,
  );

  return (
    <>
      <BackLink href="/settings" label={ru.pages.settings} />
      <PageHeader
        title={ru.pages.reminderSettings}
        description={remindersText.settings.description}
      />
      <ReminderSettingsForm
        reminderDays={context.reminderDays}
        templates={context.templates}
        gymName={context.gymName}
        preview={preview ?? SAMPLE_CONTACT}
        previewName={preview?.name ?? null}
        today={now}
        save={saveReminderSettingsAction}
      />
    </>
  );
}
