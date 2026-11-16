import { History } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { fmt } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { getI18n } from "@/i18n/server";
import { businessDate } from "@/lib/dates";

import { formatWhen, kindLabel } from "../labels";
import type {
  NamedReminderEvent,
  ReminderEvent,
  ReminderHistory,
  RemindersOverdue,
  RemindersToday,
  ReminderTarget,
} from "../service";
import { type MarkReminderSent, MarkSentButton } from "./mark-sent-button";
import { type OpenReminder, WhatsAppButton } from "./whatsapp-button";

function whatsappLabels(r: Messages["reminders"]) {
  return {
    whatsapp: r.whatsapp,
    chatOpened: r.chatOpened,
    recordFailed: r.recordFailed,
    retry: r.retry,
  };
}

function markLabels(r: Messages["reminders"]) {
  return { markSent: r.markSent, marking: r.marking, failed: r.markFailed };
}

/** The reminder texts of this request; every component here asks, the lookup is cached. */
async function reminderTexts() {
  const i18n = await getI18n();
  const r = i18n.t.reminders;
  return { i18n, r, s: r.screen };
}

export type ReminderActions = {
  open: OpenReminder;
  mark: MarkReminderSent;
};

/**
 * A list row: who and what on the left, buttons on the right (full width on a phone, in the thumb
 * zone). Buttons stack: "Отметить отправленным" does not fit half of the column.
 */
function Row({
  children,
  actions,
  testId,
}: {
  children: ReactNode;
  actions?: ReactNode;
  testId: string;
}) {
  return (
    <li
      className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">{children}</div>
      {actions ? (
        <div className="flex shrink-0 flex-col gap-2 md:w-[17rem]">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

function ClientName({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/clients/${id}`}
      className="flex min-h-11 w-fit items-center truncate rounded-md text-base font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      {name}
    </Link>
  );
}

function List({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <ul
      className="flex flex-col divide-y rounded-xl border bg-card"
      data-testid={testId}
    >
      {children}
    </ul>
  );
}

/** What is known about an event, in words that never claim WhatsApp delivered anything. */
async function EventStatus({
  event,
  now,
}: {
  event: ReminderEvent;
  now: Date;
}) {
  const { i18n, r } = await reminderTexts();
  return event.status === "marked_sent" && event.markedSentAt ? (
    <span className="text-status-active-foreground">
      {fmt(r.markedSent, {
        when: formatWhen(event.markedSentAt, now, i18n.locale),
        by: event.markedSentByName ?? "",
      })}
    </span>
  ) : (
    <span className="text-muted-foreground">
      {fmt(r.chatOpenedAt, {
        when: formatWhen(event.openedAt, now, i18n.locale),
      })}
      {" · "}
      {fmt(r.openedBy, { by: event.openedByName })}
    </span>
  );
}

async function TargetMeta({
  target,
  label,
  endsLabel,
  now,
}: {
  target: ReminderTarget;
  /** The reminder kind; the overdue tab has none (the "last day" text is used for all of them). */
  label?: string;
  endsLabel: string;
  now: Date;
}) {
  const { i18n, s } = await reminderTexts();
  return (
    <span className="flex flex-wrap gap-x-2 text-muted-foreground">
      {label ? <span>{label}</span> : null}
      {target.endsOn ? (
        <span>
          {endsLabel}:{" "}
          <DateText date={target.endsOn} today={now} locale={i18n.locale} />
        </span>
      ) : null}
      <span>{target.groupName ?? s.noGroup}</span>
    </span>
  );
}

async function OpenButton({
  target,
  actions,
  variant,
}: {
  target: ReminderTarget;
  actions: ReminderActions;
  variant?: "default" | "outline";
}) {
  const { r } = await reminderTexts();
  return target.href ? (
    <WhatsAppButton
      href={target.href}
      target={{ paymentId: target.paymentId, kind: target.kind }}
      labels={whatsappLabels(r)}
      open={actions.open}
      variant={variant}
    />
  ) : null;
}

/** "Today": who to remind now (the Today screen's list), then the chats already opened today. */
export async function TodayTab({
  data,
  now,
  actions,
}: {
  data: RemindersToday;
  now: Date;
  actions: ReminderActions;
}) {
  const { i18n, s } = await reminderTexts();
  return (
    <>
      <section aria-labelledby="due-title" className="flex flex-col gap-3">
        <h2 id="due-title" className="text-lg font-semibold">
          {s.dueTitle}
        </h2>
        {data.due.length === 0 ? (
          <EmptyState
            mood="ok"
            title={s.dueEmptyTitle}
            description={s.dueEmptyText}
          />
        ) : (
          <List testId="due-list">
            {data.due.map((target) => (
              <Row
                key={target.clientId}
                testId="due-row"
                actions={<OpenButton target={target} actions={actions} />}
              >
                <ClientName id={target.clientId} name={target.name} />
                <TargetMeta
                  target={target}
                  label={kindLabel(i18n, target.kind, data.reminderDays)}
                  endsLabel={s.endsOn}
                  now={now}
                />
              </Row>
            ))}
          </List>
        )}
      </section>
      <section aria-labelledby="opened-title" className="flex flex-col gap-3">
        <h2 id="opened-title" className="text-lg font-semibold">
          {s.openedTitle}
        </h2>
        {data.opened.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.openedEmpty}</p>
        ) : (
          <EventList
            events={data.opened}
            now={now}
            actions={actions}
            testId="opened-list"
          />
        )}
      </section>
    </>
  );
}

async function EventList({
  events,
  now,
  actions,
  testId,
}: {
  events: NamedReminderEvent[];
  now: Date;
  actions: ReminderActions;
  testId: string;
}) {
  const { r } = await reminderTexts();
  return (
    <List testId={testId}>
      {events.map((event) => (
        <Row
          key={event.id}
          testId="event-row"
          actions={
            event.status === "chat_opened" ? (
              <MarkSentButton
                eventId={event.id}
                labels={markLabels(r)}
                mark={actions.mark}
              />
            ) : undefined
          }
        >
          <ClientName id={event.clientId} name={event.name} />
          <span className="text-muted-foreground">
            {r.kindShort[event.kind]}
          </span>
          <EventStatus event={event} now={now} />
        </Row>
      ))}
    </List>
  );
}

/** "Overdue": ended subscriptions with their "last day" reminder and what happened to it. */
export async function OverdueTab({
  data,
  now,
  actions,
  cut,
}: {
  data: RemindersOverdue;
  now: Date;
  actions: ReminderActions;
  /** True when the list hit the row limit. */
  cut: boolean;
}) {
  const { r, s } = await reminderTexts();
  if (data.overdue.length === 0) {
    return (
      <EmptyState
        mood="champion"
        title={s.overdueEmptyTitle}
        description={s.overdueEmptyText}
      />
    );
  }
  return (
    <>
      <List testId="overdue-list">
        {data.overdue.map((target) => (
          <Row
            key={target.clientId}
            testId="overdue-row"
            actions={
              <>
                <OpenButton
                  target={target}
                  actions={actions}
                  variant={target.event ? "outline" : "default"}
                />
                {target.event?.status === "chat_opened" ? (
                  <MarkSentButton
                    eventId={target.event.id}
                    labels={markLabels(r)}
                    mark={actions.mark}
                  />
                ) : null}
              </>
            }
          >
            <ClientName id={target.clientId} name={target.name} />
            <TargetMeta target={target} endsLabel={s.endedOn} now={now} />
            {target.event ? (
              <EventStatus event={target.event} now={now} />
            ) : null}
          </Row>
        ))}
      </List>
      {cut ? (
        <p className="text-sm text-muted-foreground">
          {fmt(s.cut, { shown: data.overdue.length })}
        </p>
      ) : null}
    </>
  );
}

/** "History": one day's events, filtered by employee; a plain GET form, no client code. */
export async function HistoryTab({
  data,
  now,
  date,
  staffId,
  actions,
  cut,
}: {
  data: ReminderHistory;
  now: Date;
  /** YYYY-MM-DD shown; today when the address has none. */
  date: string;
  staffId: string | undefined;
  actions: ReminderActions;
  cut: boolean;
}) {
  const { s } = await reminderTexts();
  return (
    <>
      <form
        method="get"
        action="/reminders"
        className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:flex-row md:items-end"
      >
        <input type="hidden" name="tab" value="history" />
        <label className="flex flex-col gap-1.5 text-sm font-medium md:w-48">
          {s.historyDate}
          <input
            type="date"
            name="date"
            defaultValue={date}
            max={businessDate(now)}
            className={inputClassName}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium md:w-64">
          {s.historyStaff}
          <select
            name="staff"
            defaultValue={staffId ?? ""}
            className={inputClassName}
          >
            <option value="">{s.historyAllStaff}</option>
            {data.staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className={buttonVariants({ variant: "outline" })}
        >
          <History aria-hidden />
          {s.historyShow}
        </button>
      </form>
      {data.events.length === 0 ? (
        <EmptyState
          mood="search"
          title={s.historyEmptyTitle}
          description={s.historyEmptyText}
        />
      ) : (
        <>
          <EventList
            events={data.events}
            now={now}
            actions={actions}
            testId="history-list"
          />
          {cut ? (
            <p className="text-sm text-muted-foreground">
              {fmt(s.cut, { shown: data.events.length })}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
