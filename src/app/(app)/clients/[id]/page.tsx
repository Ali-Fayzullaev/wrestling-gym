import { Archive, Pencil, TriangleAlert, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/variants";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientActions } from "@/features/clients/components/client-actions";
import { CONSENT_KINDS } from "@/features/clients/form-fields";
import { clientIdSchema } from "@/features/clients/schema";
import { getClient } from "@/features/clients/service";
import { PayButton } from "@/features/payments/components/pay-button";
import { PaymentEntryActions } from "@/features/payments/components/payment-entry-actions";
import { ReminderHistoryList } from "@/features/reminders/components/reminder-history-list";
import { ReminderComposer } from "@/features/reminders/components/send-language";
import {
  buildHistory,
  canCancel,
  canReverse,
  type HistoryEntry,
} from "@/features/payments/history";
import type { Actor } from "@/features/auth/roles";
import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";
import { formatDate, formatTime } from "@/lib/format";
import { HTML_LANG, LOCALE_NAMES } from "@/lib/locale";
import { formatPhone } from "@/lib/phone";

import { openReminderAction } from "../../reminders/actions";
import { deleteClientAction, setClientArchivedAction } from "../actions";
import { BackLink } from "@/components/back-link";
import {
  cancelPaymentAction,
  recordPaymentAction,
  reversePaymentAction,
} from "../payment-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.clients} | ${t.app.name}` };
}

/** Two database requests: the role check and client_screen() (payment history included). */
export default async function ClientPage({
  params,
}: PageProps<"/clients/[id]">) {
  const { t: messages, locale } = await getI18n();
  const clientsText = messages.clients;
  const remindersText = messages.reminders;
  const paymentsText = messages.payments;
  const c = messages.clients.card;
  const actor = await requireStaff(STAFF_ROLES);
  const id = clientIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const now = new Date();
  const screen = await getClient(await createServerDb(), now, id.data);
  if (!screen) notFound();
  const { client, parent, group, subscription, consents } = screen;
  const history = buildHistory(screen.payments);
  const consentByKind = new Map(
    consents.map((consent) => [consent.kind, consent]),
  );

  return (
    <Texts ns={["clients", "payments"]}>
      <BackLink href="/clients" label={clientsText.back} />
      <PageHeader
        title={`${client.lastName} ${client.firstName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <PayButton
              label={paymentsText.pay}
              target={{
                clientId: client.id,
                name: `${client.lastName} ${client.firstName}`,
                endsOn: subscription.endsOn,
                price: group && !group.archived ? group.price : null,
              }}
              today={now}
              record={recordPaymentAction}
              cancel={cancelPaymentAction}
            />
            <Link
              href={`/clients/${client.id}/edit`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Pencil aria-hidden />
              {clientsText.edit}
            </Link>
            <ClientActions
              clientId={client.id}
              lastName={client.lastName}
              archived={client.archived}
              canDelete={actor.role === "owner"}
              setArchived={setClientArchivedAction}
              remove={deleteClientAction}
            />
          </div>
        }
      />
      {client.archived ? (
        <p
          className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-3 text-sm"
          data-testid="client-archived"
        >
          <Archive aria-hidden className="size-4 shrink-0" />
          {c.archivedNotice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={c.subscription}>
          <div className="flex flex-col gap-2">
            <StatusBadge
              status={subscription.status}
              label={messages.status[subscription.status]}
            />
            {subscription.endsOn && subscription.periodStart ? (
              <>
                <dl className="grid gap-2 text-sm">
                  <Row label={c.period}>
                    <DateText
                      date={subscription.periodStart}
                      today={now}
                      locale={locale}
                    />{" "}
                    –{" "}
                    <DateText
                      date={subscription.endsOn}
                      today={now}
                      locale={locale}
                    />
                  </Row>
                </dl>
                {subscription.daysLeft !== null ? (
                  <p className="text-sm text-muted-foreground">
                    {subscription.daysLeft >= 0
                      ? fmt(c.daysLeft, { days: subscription.daysLeft })
                      : fmt(c.overdueBy, { days: -subscription.daysLeft })}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{c.noPayments}</p>
            )}
          </div>
        </Section>

        <Section title={c.group}>
          {group ? (
            <div className="grid gap-2 text-sm">
              <Link
                href={`/groups/${group.id}`}
                className="w-fit font-medium underline-offset-4 hover:underline"
              >
                {group.name}
              </Link>
              <p className="text-muted-foreground">
                {c.coach}: {group.coachName}
              </p>
              {group.archived ? (
                <div
                  className="grid gap-2 rounded-md bg-status-expiring px-3 py-2 text-status-expiring-foreground"
                  data-testid="group-archived"
                >
                  <p className="flex items-start gap-2">
                    <TriangleAlert
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0"
                    />
                    {c.groupArchived}
                  </p>
                  <Link
                    href={`/clients/${client.id}/edit`}
                    className="w-fit font-medium underline underline-offset-4"
                  >
                    {c.moveToGroup}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{c.noGroup}</p>
          )}
        </Section>

        <Section title={c.contacts}>
          <dl className="grid gap-2 text-sm">
            <Row label={c.phone}>
              {client.phone ? (
                <span className="tabular-nums">
                  {formatPhone(client.phone)}
                </span>
              ) : (
                <span className="text-muted-foreground">{c.noPhone}</span>
              )}
            </Row>
            {client.birthDate ? (
              <Row label={c.birthDate}>
                <DateText date={client.birthDate} today={now} locale={locale} />
              </Row>
            ) : null}
            <Row label={c.startedOn}>
              <DateText date={client.startedOn} today={now} locale={locale} />
            </Row>
            {parent ? null : (
              <Row label={c.messageLocale}>
                <span lang={HTML_LANG[client.messageLocale]}>
                  {LOCALE_NAMES[client.messageLocale]}
                </span>
              </Row>
            )}
          </dl>
        </Section>

        {parent ? (
          <Section title={c.parent}>
            <div className="grid gap-3 text-sm" data-testid="client-parent">
              <dl className="grid gap-2">
                <Row label={c.parentName}>
                  <Link
                    href={`/parents/${parent.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {parent.name}
                  </Link>
                  {parent.archived ? (
                    <span
                      className="text-muted-foreground"
                      data-testid="client-parent-archived"
                    >
                      {" "}
                      ({c.parentArchived})
                    </span>
                  ) : null}
                </Row>
                <Row label={c.phone}>
                  <span className="tabular-nums">
                    {formatPhone(parent.phone)}
                  </span>
                </Row>
                <Row label={c.messageLocale}>
                  <span lang={HTML_LANG[parent.messageLocale]}>
                    {LOCALE_NAMES[parent.messageLocale]}
                  </span>
                </Row>
              </dl>
              <p className="text-muted-foreground">{c.parentReminders}</p>
              {parent.archived ? null : (
                <Link
                  href={`/clients/new?parent=${parent.id}`}
                  className={`${buttonVariants({ variant: "outline" })} w-full sm:w-fit`}
                  data-testid="add-sibling"
                >
                  <UserPlus aria-hidden />
                  {c.addSibling}
                </Link>
              )}
            </div>
          </Section>
        ) : null}

        <Section title={c.consents}>
          <dl className="grid gap-2 text-sm">
            {CONSENT_KINDS.map((kind) => {
              const consent = consentByKind.get(kind);
              return (
                <Row key={kind} label={messages.clientForm.consentKinds[kind]}>
                  {consent ? (
                    fmt(c.consentGiven, {
                      date: formatDate(consent.givenOn, now, locale),
                      by: consent.recordedBy,
                    })
                  ) : (
                    <span className="text-status-expired-foreground">
                      {c.consentMissing}
                    </span>
                  )}
                </Row>
              );
            })}
          </dl>
        </Section>

        {screen.reminder && !client.archived ? (
          <Section title={c.reminderPreview} className="lg:col-span-2">
            <p className="text-sm text-muted-foreground">
              {remindersText.kindShort[screen.reminder.kind]}
            </p>
            <ReminderComposer
              message={screen.reminder.message}
              target={{
                paymentId: screen.reminder.paymentId,
                kind: screen.reminder.kind,
              }}
              labels={remindersText.sendLanguage}
              whatsappLabels={{
                whatsapp: remindersText.whatsapp,
                chatOpened: remindersText.chatOpened,
                recordFailed: remindersText.recordFailed,
                retry: remindersText.retry,
              }}
              hint={c.reminderPreviewHint}
              open={openReminderAction}
            />
          </Section>
        ) : null}

        <Section title={c.note} className="lg:col-span-2">
          <p className="text-sm break-words whitespace-pre-line">
            {client.note || (
              <span className="text-muted-foreground">{c.noNote}</span>
            )}
          </p>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="payments-title"
          className="flex flex-col gap-3"
        >
          <h2 id="payments-title" className="text-lg font-semibold">
            {c.payments}
          </h2>
          {history.length === 0 ? (
            <EmptyState
              mood="hello"
              compact
              title={paymentsText.history.emptyTitle}
              description={paymentsText.history.emptyText}
            />
          ) : (
            <ul
              className="flex flex-col divide-y rounded-xl border bg-card"
              data-testid="payment-history"
            >
              {history.map((entry) => (
                <PaymentEntry
                  key={entry.payment.id}
                  entry={entry}
                  actor={actor}
                  now={now}
                />
              ))}
            </ul>
          )}
        </section>
        <section
          aria-labelledby="reminders-title"
          className="flex flex-col gap-3"
        >
          <h2 id="reminders-title" className="text-lg font-semibold">
            {c.reminders}
          </h2>
          {screen.reminders.length === 0 ? (
            <EmptyState
              mood="ok"
              compact
              title={c.remindersEmpty}
              description={c.remindersEmptyText}
            />
          ) : (
            <ReminderHistoryList events={screen.reminders} now={now} />
          )}
        </section>
      </div>
    </Texts>
  );
}

async function PaymentEntry({
  entry,
  actor,
  now,
}: {
  entry: HistoryEntry;
  actor: Actor;
  now: Date;
}) {
  const { t: messages, locale } = await getI18n();
  const paymentsText = messages.payments;
  const h = messages.payments.history;
  const { payment, reversal } = entry;
  const paidAt = new Date(payment.createdAt);
  const cancellable = canCancel(entry, actor, now);
  const reversible = canReverse(entry, actor);
  return (
    <li
      className="flex flex-col gap-2 px-4 py-3 text-sm"
      data-testid="payment-entry"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {payment.method === null ? (
          <span className="text-base font-semibold">{h.importBalance}</span>
        ) : (
          <Money
            amount={payment.amount}
            locale={locale}
            className={
              reversal
                ? "text-base font-semibold text-muted-foreground line-through"
                : "text-base font-semibold"
            }
          />
        )}
        <span className="text-muted-foreground">
          {fmt(h.paidAt, {
            date: formatDate(paidAt, now, locale),
            time: formatTime(paidAt),
          })}
        </span>
      </div>
      <p>
        {payment.method === null
          ? h.importBalanceNote
          : paymentsText.dialog.methods[payment.method]}
        {" · "}
        <span className="tabular-nums">
          {fmt(h.period, {
            from: formatDate(payment.periodStart, now, locale),
            to: formatDate(payment.periodEnd, now, locale),
          })}
        </span>
      </p>
      <p className="text-muted-foreground">
        {fmt(h.by, { name: payment.createdByName })}
      </p>
      {reversal ? (
        <div
          className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2"
          data-testid="payment-reversal"
        >
          <p className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">
              {fmt(h.reversed, {
                date: formatDate(new Date(reversal.createdAt), now, locale),
                name: reversal.createdByName,
              })}
            </span>
            <Money amount={reversal.amount} locale={locale} />
          </p>
          {reversal.reason ? (
            <p className="break-words text-muted-foreground">
              {fmt(h.reason, { reason: reversal.reason })}
            </p>
          ) : null}
        </div>
      ) : null}
      {cancellable || reversible ? (
        <PaymentEntryActions
          paymentId={payment.id}
          cancelLabel={cancellable ? paymentsText.cancel : null}
          reverseLabel={reversible ? paymentsText.reverse : null}
          cancel={cancelPaymentAction}
          reverse={reversePaymentAction}
        />
      ) : null}
    </li>
  );
}

function Section({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${className}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
