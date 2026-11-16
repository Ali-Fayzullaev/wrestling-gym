import { BellRing, ChevronRight, type LucideIcon, UserCog } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type * as React from "react";

import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { CreateGroupButton } from "@/features/groups/components/create-group-button";
import { GroupOwnerActions } from "@/features/groups/components/group-owner-actions";
import { formatSchedule } from "@/features/groups/format";
import { listGroups } from "@/features/groups/service";
import { GymSettingsForm } from "@/features/settings/components/gym-settings-form";
import { getSettings } from "@/features/settings/service";
import { fmt, plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import {
  archiveGroupAction,
  createGroupAction,
  updateGroupAction,
} from "../groups/actions";
import { saveGymSettingsAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.settings} | ${t.app.name}` };
}

/**
 * "Settings" (D-11): everything the owner changes without a programmer, in one place. Owner only,
 * here and in the proxy. Three database requests: the role check, the settings row and
 * groups_screen(), the last two in parallel.
 */
export default async function SettingsPage() {
  const { t: messages, locale } = await getI18n();
  const t = messages.settings;
  await requireStaff(["owner"]);
  const db = await createServerDb();
  const [settings, { groups, coaches }] = await Promise.all([
    getSettings(db),
    listGroups(db, new Date()),
  ]);
  const days = [...settings.reminderDays]
    .sort((a, b) => b - a)
    .map((day) => plural(locale, t.daysWord, day))
    .join(t.daysJoin);

  return (
    <Texts ns={["settings", "groups"]}>
      <PageHeader title={messages.pages.settings} description={t.description} />

      <Section id="settings-gym" title={t.gym.title}>
        <GymSettingsForm
          initial={{
            gymName: settings.gymName,
            gymWhatsapp: settings.gymWhatsapp,
          }}
          save={saveGymSettingsAction}
        />
      </Section>

      <Section
        id="settings-groups"
        title={t.groups.title}
        hint={t.groups.hint}
        action={
          <CreateGroupButton coaches={coaches} create={createGroupAction} />
        }
      >
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.groups.empty}</p>
        ) : (
          <ul className="-mx-4 flex flex-col divide-y border-t">
            {groups.map((group) => (
              <li
                key={group.id}
                data-testid="settings-group"
                className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Link
                    href={`/groups/${group.id}`}
                    className="w-fit font-semibold break-words underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
                  >
                    {group.name}
                  </Link>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted-foreground">{t.groups.price}</dt>
                    <dd
                      className="font-medium tabular-nums"
                      data-testid="settings-group-price"
                    >
                      <Money locale={locale} amount={group.defaultPrice} />
                    </dd>
                    <dt className="text-muted-foreground">{t.groups.coach}</dt>
                    <dd>{group.coachName}</dd>
                    <dt className="text-muted-foreground">
                      {t.groups.schedule}
                    </dt>
                    <dd>{formatSchedule(group.schedule, messages.groups)}</dd>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  <GroupOwnerActions
                    groupId={group.id}
                    values={{
                      name: group.name,
                      coachId: group.coachId,
                      schedule: group.schedule,
                      defaultPrice: group.defaultPrice,
                      capacity: group.capacity,
                    }}
                    members={group.members}
                    coaches={coaches}
                    update={updateGroupAction.bind(null, group.id)}
                    archive={archiveGroupAction}
                    returnTo="/settings"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <LinkSection
        id="settings-reminders"
        title={t.reminders.title}
        hint={t.reminders.hint}
        status={fmt(t.reminders.days, { days })}
        href="/settings/reminders"
        label={t.reminders.open}
        icon={BellRing}
      />

      <LinkSection
        id="settings-staff"
        title={t.staff.title}
        hint={t.staff.hint}
        href="/settings/staff"
        label={t.staff.open}
        icon={UserCog}
      />
    </Texts>
  );
}

function Section({
  id,
  title,
  hint,
  action,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {hint ? (
            <p className="text-sm text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkSection({
  id,
  title,
  hint,
  status,
  href,
  label,
  icon: Icon,
}: {
  id: string;
  title: string;
  hint: string;
  status?: string;
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Section id={id} title={title} hint={hint}>
      {status ? (
        <p className="text-sm" data-testid={`${id}-status`}>
          {status}
        </p>
      ) : null}
      <Link
        href={href}
        className="-mx-4 -mb-4 flex min-h-12 items-center gap-3 rounded-b-xl border-t px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Icon aria-hidden className="size-5 text-muted-foreground" />
        <span className="flex-1">{label}</span>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
      </Link>
    </Section>
  );
}
