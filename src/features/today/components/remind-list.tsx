"use client";

import { Users, Wallet } from "lucide-react";
import { lazy, type ReactNode, Suspense, useOptimistic, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useLocale } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import type {
  CancelPayment,
  PaymentTarget,
  RecordPayment,
} from "@/features/payments/components/payment-dialog";
import {
  type OpenReminder,
  type WhatsAppLabels,
  WhatsAppButton,
} from "@/features/reminders/components/whatsapp-button";
import {
  ReminderPreview,
  type SendLanguageLabels,
  SendLanguagePicker,
} from "@/features/reminders/components/send-language";
import type { ReminderMessage } from "@/features/reminders/service";
import type { ReminderTargetInput } from "@/features/reminders/result";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

import type { TodayRemindGroup, TodayRow } from "../service";
import { ClientSummaryLink } from "./client-summary-link";

// The payment dialog, its texts and the toasts load on first intent: the screen stays within budget.
// No cn here either, for the same reason.
const loadPaymentDialog = () =>
  import("@/features/payments/components/payment-dialog");
const PaymentDialog = lazy(loadPaymentDialog);

/** The paid client leaves the list at once; the server's next rows confirm it (or bring it back). */
function withoutPaid(
  groups: TodayRemindGroup[],
  paidId: string,
): TodayRemindGroup[] {
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => row.id !== paidId),
    }))
    .filter((group) => group.rows.length > 0);
}

type RowLabels = { pay: string; noGroup: string; endsOn: string };

export type RemindListLabels = RowLabels & {
  /** "{parent} (родитель): {children}". */
  family: string;
  familyHint: string;
};

/**
 * "Remind today": one block per message. A client reminded on their own phone (or a single child
 * through the parent) is one row with "WhatsApp" and "Paid"; a parent with several children due
 * today is one block with one message about all of them and "Paid" per child (D-18, D-19). The
 * labels and the ready wa.me links (one per language) come from the server, so the screen's texts
 * and the template code stay out of this island. Opening a chat is not removed here: the server's
 * next rows (reminders_due) drop the clients and the counter together.
 */
export function RemindList({
  rows,
  empty,
  today,
  labels,
  whatsappLabels,
  sendLanguageLabels,
  recordPayment,
  cancelPayment,
  openReminder,
}: {
  rows: TodayRemindGroup[];
  /** Shown when nobody is left to remind, also right after the last one paid. */
  empty: ReactNode;
  today: Date;
  labels: RemindListLabels;
  whatsappLabels: WhatsAppLabels;
  sendLanguageLabels: SendLanguageLabels;
  recordPayment: RecordPayment;
  cancelPayment: CancelPayment;
  openReminder: OpenReminder;
}) {
  const locale = useLocale();
  const [shownGroups, markPaid] = useOptimistic(rows, withoutPaid);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const pay = (row: TodayRow) => {
    setPayTarget({
      clientId: row.id,
      name: row.name,
      endsOn: row.endsOn,
      price: row.price,
    });
    setPayOpen(true);
  };
  const shared = {
    today,
    locale,
    labels,
    whatsappLabels,
    sendLanguageLabels,
    openReminder,
    onPay: pay,
  };

  return (
    <>
      {shownGroups.length === 0 ? empty : null}
      <ul
        hidden={shownGroups.length === 0}
        className="flex flex-col divide-y rounded-xl border bg-card"
        data-testid="remind-list"
      >
        {shownGroups.map((group) =>
          group.parent && group.rows.length > 1 ? (
            <FamilyBlock
              key={`parent-${group.parent.id}`}
              group={group}
              parentName={group.parent.name}
              {...shared}
            />
          ) : (
            <SingleRow key={group.rows[0]?.id} group={group} {...shared} />
          ),
        )}
      </ul>
      {payTarget ? (
        <Suspense fallback={null}>
          <PaymentDialog
            // One form (and one idempotency key) per client.
            key={payTarget.clientId}
            target={payTarget}
            today={today}
            open={payOpen}
            onOpenChange={setPayOpen}
            record={recordPayment}
            cancel={cancelPayment}
            onOptimistic={() => markPaid(payTarget.clientId)}
          />
        </Suspense>
      ) : null}
    </>
  );
}

type Shared = {
  today: Date;
  locale: Locale;
  labels: RemindListLabels;
  whatsappLabels: WhatsAppLabels;
  sendLanguageLabels: SendLanguageLabels;
  openReminder: OpenReminder;
  onPay: (row: TodayRow) => void;
};

/** The language of this message (D-17), chosen per block; starts with the one on the card. */
function useSendLocale(message: ReminderMessage | null) {
  return useState<Locale>(message?.defaultLocale ?? DEFAULT_LOCALE);
}

function PayButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={buttonVariants()}
      onPointerEnter={() => void loadPaymentDialog()}
      onFocus={() => void loadPaymentDialog()}
      onClick={onClick}
      data-testid="pay-button"
    >
      <Wallet aria-hidden />
      {label}
    </button>
  );
}

/**
 * One client to remind: who, the WhatsApp and "Paid" buttons, and under them the language of this
 * message (D-17) with the text folded away, so a long list stays short. Switching the language
 * only swaps texts already on the page.
 */
function SingleRow({
  group,
  today,
  locale,
  labels,
  whatsappLabels,
  sendLanguageLabels,
  openReminder,
  onPay,
}: Shared & { group: TodayRemindGroup }) {
  const [sendLocale, setSendLocale] = useSendLocale(group.message);
  const row = group.rows[0];
  if (!row) return null;
  const variant = group.message?.variants[sendLocale];
  return (
    <li className="flex flex-col gap-3 px-4 py-3" data-testid="remind-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <ClientSummaryLink
          row={row}
          today={today}
          locale={locale}
          labels={labels}
        />
        <div className="grid shrink-0 grid-cols-2 gap-2 md:w-[17rem]">
          {variant ? (
            <WhatsAppButton
              href={variant.href}
              target={{ ...group.target, locale: sendLocale }}
              labels={whatsappLabels}
              open={openReminder}
            />
          ) : (
            // No template of this kind: nothing to open, the place is kept so rows line up.
            <span aria-hidden className="invisible h-11" />
          )}
          <PayButton label={labels.pay} onClick={() => onPay(row)} />
        </div>
      </div>
      {variant ? (
        <MessageDetails
          variant={variant}
          sendLocale={sendLocale}
          onLocale={setSendLocale}
          labels={sendLanguageLabels}
        />
      ) : null}
    </li>
  );
}

/**
 * A parent with several children due today: "Айгуль (родитель): Арман, Дана", one WhatsApp button
 * for one message about all of them (it records "chat opened" for each child), the language and
 * text, then the children, each with "Paid": their payments stay separate (D-19).
 */
function FamilyBlock({
  group,
  parentName,
  today,
  locale,
  labels,
  whatsappLabels,
  sendLanguageLabels,
  openReminder,
  onPay,
}: Shared & { group: TodayRemindGroup; parentName: string }) {
  const [sendLocale, setSendLocale] = useSendLocale(group.message);
  const variant = group.message?.variants[sendLocale];
  const target: ReminderTargetInput = group.target;
  return (
    <li className="flex flex-col gap-3 px-4 py-3" data-testid="remind-family">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-h-11 min-w-0 items-start gap-2.5">
          <Users aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="grid min-w-0 gap-0.5">
            <p
              className="font-medium break-words"
              data-testid="remind-family-title"
            >
              {fmt(labels.family, {
                parent: parentName,
                children: group.firstNames.join(", "),
              })}
            </p>
            <p className="text-sm text-muted-foreground">{labels.familyHint}</p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 md:w-[17rem]">
          {variant ? (
            <WhatsAppButton
              href={variant.href}
              target={{ ...target, locale: sendLocale }}
              labels={whatsappLabels}
              open={openReminder}
            />
          ) : (
            <span aria-hidden className="invisible h-11" />
          )}
        </div>
      </div>
      {variant ? (
        <MessageDetails
          variant={variant}
          sendLocale={sendLocale}
          onLocale={setSendLocale}
          labels={sendLanguageLabels}
        />
      ) : null}
      <ul className="flex flex-col divide-y rounded-lg border">
        {group.rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            data-testid="remind-row"
          >
            <ClientSummaryLink
              row={row}
              today={today}
              locale={locale}
              labels={labels}
            />
            <div className="grid shrink-0 grid-cols-1 sm:w-[8.25rem]">
              <PayButton label={labels.pay} onClick={() => onPay(row)} />
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

function MessageDetails({
  variant,
  sendLocale,
  onLocale,
  labels,
}: {
  variant: NonNullable<ReminderMessage["variants"][Locale]>;
  sendLocale: Locale;
  onLocale: (locale: Locale) => void;
  labels: SendLanguageLabels;
}) {
  return (
    <div className="flex flex-col gap-1">
      <SendLanguagePicker
        locale={sendLocale}
        variant={variant}
        onChange={onLocale}
        labels={labels}
      />
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline-offset-4 hover:underline">
          {labels.showText}
        </summary>
        <div className="flex flex-col gap-2">
          <ReminderPreview variant={variant} />
          <p className="text-sm text-muted-foreground">{labels.hint}</p>
        </div>
      </details>
    </div>
  );
}
