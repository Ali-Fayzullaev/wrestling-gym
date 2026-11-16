import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { ReminderSettingsForm } from "@/features/reminders/components/reminder-settings-form";
import { getReminderSettings } from "@/features/reminders/service";
import type { ReminderContact } from "@/features/reminders/template";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { BackLink } from "@/components/back-link";
import { saveReminderSettingsAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.reminderSettings} | ${t.app.name}` };
}

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
  const { t } = await getI18n();
  const now = new Date();
  const { context, preview } = await getReminderSettings(
    await createServerDb(),
    now,
  );

  return (
    <Texts ns={["reminders"]}>
      <BackLink href="/settings" label={t.pages.settings} />
      <PageHeader
        title={t.pages.reminderSettings}
        description={t.reminders.settings.description}
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
    </Texts>
  );
}
