import { Info, MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { PillNav } from "@/components/pill-nav";
import { buttonVariants } from "@/components/ui/variants";
import type { Db } from "@/db/client";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import {
  HistoryTab,
  OverdueTab,
  TodayTab,
} from "@/features/reminders/components/reminder-tabs";
import { historyFilterSchema } from "@/features/reminders/schema";
import {
  getReminderHistory,
  getRemindersOverdue,
  getRemindersToday,
  HISTORY_LIMIT,
} from "@/features/reminders/service";
import { getI18n } from "@/i18n/server";
import { businessDate } from "@/lib/dates";

import {
  markFamilySentAction,
  markReminderSentAction,
  openReminderAction,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.reminders} | ${t.app.name}` };
}

const TABS = ["today", "overdue", "history"] as const;
type Tab = (typeof TABS)[number];

const TAB_HREF: Record<Tab, string> = {
  today: "/reminders",
  overdue: "/reminders?tab=overdue",
  history: "/reminders?tab=history",
};

function parseTab(value: string | string[] | undefined): Tab {
  return TABS.find((tab) => tab === value) ?? "today";
}

const actions = {
  open: openReminderAction,
  mark: markReminderSentAction,
  markFamily: markFamilySentAction,
};

/** Two database requests: the role check and one tab of reminders_screen(). */
export default async function RemindersPage({
  searchParams,
}: PageProps<"/reminders">) {
  const actor = await requireStaff(STAFF_ROLES);
  const { t } = await getI18n();
  const s = t.reminders.screen;
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const now = new Date();
  const db = await createServerDb();

  return (
    <>
      <PageHeader
        title={t.pages.reminders}
        mascot="hello"
        actions={
          actor.role === "owner" ? (
            <Link
              href="/settings/reminders"
              className={buttonVariants({ variant: "outline" })}
            >
              <MessageSquareText aria-hidden />
              {s.settingsLink}
            </Link>
          ) : null
        }
      />
      <p className="flex items-start gap-2 rounded-xl border bg-muted px-4 py-3 text-sm">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {s.hint}
      </p>
      <PillNav
        label={s.tabsLabel}
        current={tab}
        items={TABS.map((key) => ({
          key,
          href: TAB_HREF[key],
          text: s.tabs[key],
        }))}
      />
      {tab === "today" ? (
        <TodayTab
          data={await getRemindersToday(db, now)}
          now={now}
          actions={actions}
        />
      ) : tab === "overdue" ? (
        <OverdueContent db={db} now={now} />
      ) : (
        <HistoryContent db={db} now={now} params={params} />
      )}
    </>
  );
}

async function OverdueContent({ db, now }: { db: Db; now: Date }) {
  const data = await getRemindersOverdue(db, now);
  return (
    <OverdueTab
      data={data}
      now={now}
      actions={actions}
      cut={data.rows >= HISTORY_LIMIT}
    />
  );
}

async function HistoryContent({
  db,
  now,
  params,
}: {
  db: Db;
  now: Date;
  params: Record<string, string | string[] | undefined>;
}) {
  const filter = historyFilterSchema.parse({
    date: params.date,
    staff: params.staff,
  });
  const data = await getReminderHistory(db, now, filter);
  return (
    <HistoryTab
      data={data}
      now={now}
      date={filter.date ?? businessDate(now)}
      staffId={filter.staff}
      actions={actions}
      cut={data.events.length >= HISTORY_LIMIT}
    />
  );
}
