"use client";

import { Wallet } from "lucide-react";
import { lazy, type ReactNode, Suspense, useOptimistic, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useLocale } from "@/i18n/client";
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

import type { TodayRemindRow } from "../service";
import { ClientSummaryLink } from "./client-summary-link";

// The payment dialog, its texts and the toasts load on first intent: the screen stays within budget.
// No cn here either, for the same reason.
const loadPaymentDialog = () =>
  import("@/features/payments/components/payment-dialog");
const PaymentDialog = lazy(loadPaymentDialog);

/** The paid client leaves the list at once; the server's next rows confirm it (or bring it back). */
function withoutPaid(rows: TodayRemindRow[], paidId: string): TodayRemindRow[] {
  return rows.filter((row) => row.id !== paidId);
}

/**
 * "Remind today" with "WhatsApp" and "Paid" buttons per row. The labels and the ready wa.me links
 * come from the server, so the screen's texts and the template code stay out of this island.
 * Opening a chat is not removed here: the server's next rows (reminders_due) drop the client and
 * the counter together.
 */
export function RemindList({
  rows,
  empty,
  today,
  labels,
  whatsappLabels,
  recordPayment,
  cancelPayment,
  openReminder,
}: {
  rows: TodayRemindRow[];
  /** Shown when nobody is left to remind, also right after the last one paid. */
  empty: ReactNode;
  today: Date;
  labels: { pay: string; noGroup: string; endsOn: string };
  whatsappLabels: WhatsAppLabels;
  recordPayment: RecordPayment;
  cancelPayment: CancelPayment;
  openReminder: OpenReminder;
}) {
  const locale = useLocale();
  const [shownRows, markPaid] = useOptimistic(rows, withoutPaid);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  return (
    <>
      {shownRows.length === 0 ? empty : null}
      <ul
        hidden={shownRows.length === 0}
        className="flex flex-col divide-y rounded-xl border bg-card"
        data-testid="remind-list"
      >
        {shownRows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
            data-testid="remind-row"
          >
            <ClientSummaryLink
              row={row}
              today={today}
              locale={locale}
              labels={labels}
            />
            <div className="grid shrink-0 grid-cols-2 gap-2 md:w-[17rem]">
              {row.reminder.href ? (
                <WhatsAppButton
                  href={row.reminder.href}
                  target={{
                    paymentId: row.reminder.paymentId,
                    kind: row.reminder.kind,
                  }}
                  labels={whatsappLabels}
                  open={openReminder}
                />
              ) : (
                // No template of this kind: nothing to open, the place is kept so rows line up.
                <span aria-hidden className="invisible h-11" />
              )}
              <button
                type="button"
                className={buttonVariants()}
                onPointerEnter={() => void loadPaymentDialog()}
                onFocus={() => void loadPaymentDialog()}
                onClick={() => {
                  setPayTarget({
                    clientId: row.id,
                    name: row.name,
                    endsOn: row.endsOn,
                    price: row.price,
                  });
                  setPayOpen(true);
                }}
                data-testid="pay-button"
              >
                <Wallet aria-hidden />
                {labels.pay}
              </button>
            </div>
          </li>
        ))}
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
