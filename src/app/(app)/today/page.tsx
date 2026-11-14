import { CircleCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PillNav } from "@/components/pill-nav";
import { StatCard } from "@/components/stat-card";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { PaidList } from "@/features/today/components/paid-list";
import { RemindList } from "@/features/today/components/remind-list";
import { getTodayScreen } from "@/features/today/service";
import { paymentsText } from "@/i18n/payments";
import { remindersText } from "@/i18n/reminders";
import { ru } from "@/i18n/ru";
import { todayText as t } from "@/i18n/today";
import { formatWeekdayDate } from "@/lib/format";

import {
  cancelPaymentAction,
  recordPaymentAction,
} from "../clients/payment-actions";
import { openReminderAction } from "../reminders/actions";

export const metadata: Metadata = {
  title: `${ru.pages.today} | ${ru.app.name}`,
};

type ListKey = "remind" | "paid";

const LIST_HREF: Record<ListKey, string> = {
  remind: "/today",
  paid: "/today?list=paid",
};

function parseList(value: string | string[] | undefined): ListKey {
  return value === "paid" ? "paid" : "remind";
}

/**
 * Two database requests: the role check and today_screen(). The counters are dashboard_counts();
 * "remind" and "paid today" open their lists here, debtors and expiring the filtered client list.
 */
export default async function TodayPage({ searchParams }: PageProps<"/today">) {
  await requireStaff(STAFF_ROLES);
  const now = new Date();
  const [screen, params] = await Promise.all([
    getTodayScreen(await createServerDb(), now),
    searchParams,
  ]);
  const list = parseList(params.list);
  const { counts } = screen;
  const rowLabels = { noGroup: t.noGroup, endsOn: t.endsOn };

  return (
    <>
      <PageHeader title={ru.pages.today} description={formatWeekdayDate(now)} />

      <section aria-label={t.counters.label}>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <li className="contents">
            <StatCard
              label={t.counters.remindToday}
              value={counts.remindToday}
              href={LIST_HREF.remind}
              emphasis
            />
          </li>
          <li className="contents">
            <StatCard
              label={t.counters.debtors}
              value={counts.debtors}
              href="/clients?status=expired"
              emphasis
            />
          </li>
          <li className="contents">
            <StatCard
              label={t.counters.expiringWeek}
              value={counts.expiringWeek}
              href="/clients?status=expiring"
            />
          </li>
          <li className="contents">
            <StatCard
              label={t.counters.paidToday}
              value={counts.paidToday}
              href={LIST_HREF.paid}
            />
          </li>
        </ul>
      </section>

      <section aria-labelledby="today-list" className="flex flex-col gap-3">
        <h2 id="today-list" className="sr-only">
          {t.lists[list]}
        </h2>
        <PillNav
          label={t.lists.label}
          current={list}
          items={(["remind", "paid"] as const).map((key) => ({
            key,
            href: LIST_HREF[key],
            text: t.lists[key],
          }))}
        />
        {list === "remind" ? (
          <RemindList
            rows={screen.remind}
            empty={
              <EmptyState
                icon={CircleCheck}
                title={t.remindEmptyTitle}
                description={t.remindEmptyText}
              />
            }
            today={now}
            labels={{ ...rowLabels, pay: paymentsText.pay }}
            whatsappLabels={{
              whatsapp: remindersText.whatsapp,
              chatOpened: remindersText.chatOpened,
              recordFailed: remindersText.recordFailed,
              retry: remindersText.retry,
            }}
            recordPayment={recordPaymentAction}
            cancelPayment={cancelPaymentAction}
            openReminder={openReminderAction}
          />
        ) : screen.paid.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={t.paidEmptyTitle}
            description={t.paidEmptyText}
          />
        ) : (
          <PaidList rows={screen.paid} today={now} labels={rowLabels} />
        )}
      </section>
    </>
  );
}
