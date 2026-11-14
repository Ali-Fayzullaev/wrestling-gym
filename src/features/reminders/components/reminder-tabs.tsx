import { BellRing, CircleCheck, History } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { remindersText as r } from "@/i18n/reminders";
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

const s = r.screen;

const WHATSAPP_LABELS = {
  whatsapp: r.whatsapp,
  chatOpened: r.chatOpened,
  recordFailed: r.recordFailed,
  retry: r.retry,
};

const MARK_LABELS = {
  markSent: r.markSent,
  marking: r.marking,
  failed: r.markFailed,
};

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
function EventStatus({ event, now }: { event: ReminderEvent; now: Date }) {
  return event.status === "marked_sent" && event.markedSentAt ? (
    <span className="text-status-active-foreground">
      {r.markedSent(
        formatWhen(event.markedSentAt, now),
        event.markedSentByName ?? "",
      )}
    </span>
  ) : (
    <span className="text-muted-foreground">
      {r.chatOpenedAt(formatWhen(event.openedAt, now))}
      {" · "}
      {r.openedBy(event.openedByName)}
    </span>
  );
}

function TargetMeta({
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
  return (
    <span className="flex flex-wrap gap-x-2 text-muted-foreground">
      {label ? <span>{label}</span> : null}
      {target.endsOn ? (
        <span>
          {endsLabel}: <DateText date={target.endsOn} today={now} />
        </span>
      ) : null}
      <span>{target.groupName ?? s.noGroup}</span>
    </span>
  );
}

function OpenButton({
  target,
  actions,
  variant,
}: {
  target: ReminderTarget;
  actions: ReminderActions;
  variant?: "default" | "outline";
}) {
  return target.href ? (
    <WhatsAppButton
      href={target.href}
      target={{ paymentId: target.paymentId, kind: target.kind }}
      labels={WHATSAPP_LABELS}
      open={actions.open}
      variant={variant}
    />
  ) : null;
}

/** "Today": who to remind now (the Today screen's list), then the chats already opened today. */
export function TodayTab({
  data,
  now,
  actions,
}: {
  data: RemindersToday;
  now: Date;
  actions: ReminderActions;
}) {
  return (
    <>
      <section aria-labelledby="due-title" className="flex flex-col gap-3">
        <h2 id="due-title" className="text-lg font-semibold">
          {s.dueTitle}
        </h2>
        {data.due.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
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
                  label={kindLabel(target.kind, data.reminderDays)}
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

function EventList({
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
                labels={MARK_LABELS}
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
export function OverdueTab({
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
  if (data.overdue.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
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
                    labels={MARK_LABELS}
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
          {s.cut(data.overdue.length)}
        </p>
      ) : null}
    </>
  );
}

/** "History": one day's events, filtered by employee; a plain GET form, no client code. */
export function HistoryTab({
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
          icon={BellRing}
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
              {s.cut(data.events.length)}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
