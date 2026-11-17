"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useLocale, useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { businessDate } from "@/lib/dates";
import { formatDate, formatMoney } from "@/lib/format";

import {
  AMOUNT_MAX,
  PAYMENT_METHODS,
  PAYMENT_MONTHS,
  type PaymentMethod,
} from "../form-fields";
import { isEndInBounds, nextPeriod, periodEndBounds } from "../period";
import type { PaymentError, PaymentResult, RecordedPayment } from "../result";

// This dialog reports with a toast: make sure the toast area is there.
requestToaster();

export type RecordPayment = (input: {
  clientId: string;
  amount: number;
  method: PaymentMethod;
  idempotencyKey: string;
  /** Last day chosen by hand (YYYY-MM-DD); absent when the default one stays. */
  periodEnd?: string;
}) => Promise<PaymentResult<RecordedPayment>>;

export type CancelPayment = (input: {
  paymentId: string;
  idempotencyKey: string;
}) => Promise<PaymentResult<RecordedPayment>>;

export type PaymentTarget = {
  clientId: string;
  name: string;
  /** End of the current subscription (YYYY-MM-DD), null without one. */
  endsOn: string | null;
  /** The group's monthly price; null without a group. */
  price: number | null;
};

const DIGITS = /^\d+$/;

function parseAmount(text: string): number | null {
  const compact = text.replace(/\s/g, "");
  if (!DIGITS.test(compact)) return null;
  const amount = Number(compact);
  return amount >= 1 && amount <= AMOUNT_MAX ? amount : null;
}

/** Runs a payment action; a lost connection becomes a message instead of an unhandled error. */
async function settle<T>(
  call: () => Promise<PaymentResult<T>>,
): Promise<PaymentResult<T> | { ok: false; error: "network" }> {
  try {
    return await call();
  } catch {
    return { ok: false, error: "network" };
  }
}

const errorText = (t: Messages["payments"], error: PaymentError | "network") =>
  error === "network" ? t.network : t.errors[error];

/**
 * "Paid": amount (the group price filled in), method, the last day it is valid (the D-03 default,
 * changeable within bounds, D-16), one confirm tap.
 * The idempotency key is made when the form opens for a client and kept until a payment is saved,
 * so a retry after a lost connection cannot record a second payment. The dialog closes at once;
 * `onOptimistic` lets the list show the new status while the request runs.
 */
export default function PaymentDialog({
  target,
  today,
  open,
  onOpenChange,
  record,
  cancel,
  onOptimistic,
}: {
  target: PaymentTarget;
  today: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: RecordPayment;
  cancel: CancelPayment;
  onOptimistic?: (endsOn: string) => void;
}) {
  const t = useText("payments");
  const common = useText("common");
  const locale = useLocale();
  const id = useId();
  const [amountText, setAmountText] = useState(
    target.price === null ? "" : String(target.price),
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const paidOn = businessDate(today);
  const period = nextPeriod(target.endsOn, paidOn, PAYMENT_MONTHS);
  const bounds = periodEndBounds(period.start, paidOn);
  const [endText, setEndText] = useState(period.end);
  const [touched, setTouched] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [, startTransition] = useTransition();
  // A second tap may land before React re-renders the closed dialog.
  const submitting = useRef(false);

  const amount = parseAmount(amountText);
  const showAmountError = touched && amount === null;
  const endValid = isEndInBounds(endText, bounds);
  const endChanged = endText !== period.end;
  const showEndError = touched && !endValid;

  function undo(payment: RecordedPayment) {
    void settle(() =>
      cancel({ paymentId: payment.id, idempotencyKey: crypto.randomUUID() }),
    ).then((result) => {
      if (result.ok) toast.success(t.cancelled);
      else toast.error(errorText(t, result.error));
    });
  }

  function confirm() {
    setTouched(true);
    if (amount === null || !endValid || submitting.current) return;
    submitting.current = true;
    onOpenChange(false);
    startTransition(async () => {
      onOptimistic?.(endText);
      const result = await settle(() =>
        record({
          clientId: target.clientId,
          amount,
          method,
          idempotencyKey: key,
          // Only a changed date is sent: the server keeps its own default otherwise.
          ...(endChanged ? { periodEnd: endText } : {}),
        }),
      );
      submitting.current = false;
      if (!result.ok) {
        toast.error(errorText(t, result.error));
        return;
      }
      // The next payment for this client is a new one.
      setKey(crypto.randomUUID());
      const payment = result.data;
      toast.success(
        fmt(t.saved, { until: formatDate(payment.periodEnd, today, locale) }),
        {
          duration: 10_000,
          action: { label: t.undo, onClick: () => undo(payment) },
        },
      );
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.dialog.title}
      description={target.name}
      footer={
        <>
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => onOpenChange(false)}
          >
            {common.cancel}
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            className={buttonVariants()}
            data-testid="payment-confirm"
          >
            {t.dialog.confirm}
          </button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        className="flex flex-col gap-4 py-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-amount`} className="text-sm font-medium">
            {t.dialog.amount}
          </label>
          <input
            id={`${id}-amount`}
            name="amount"
            inputMode="numeric"
            autoComplete="off"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showAmountError || undefined}
            aria-describedby={`${id}-amount-hint`}
            className={`${inputClassName} tabular-nums`}
          />
          <p
            id={`${id}-amount-hint`}
            className={
              showAmountError
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {showAmountError
              ? t.dialog.amountError
              : target.price === null
                ? t.dialog.amountNoPrice
                : fmt(t.dialog.amountHint, {
                    price: formatMoney(target.price, locale),
                  })}
          </p>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">
            {t.dialog.method}
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((value) => (
              <label
                key={value}
                className="flex h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="method"
                  value={value}
                  checked={method === value}
                  onChange={() => setMethod(value)}
                  className="sr-only"
                />
                {t.dialog.methods[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-end`} className="text-sm font-medium">
            {t.dialog.periodEnd}
          </label>
          <input
            id={`${id}-end`}
            name="periodEnd"
            type="date"
            required
            min={bounds.min}
            max={bounds.max}
            value={endText}
            onChange={(event) => setEndText(event.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showEndError || undefined}
            aria-describedby={`${id}-end-hint`}
            className={`${inputClassName} tabular-nums`}
            data-testid="payment-period-end"
          />
          <div
            id={`${id}-end-hint`}
            className="flex flex-col gap-0.5 text-sm"
            data-testid="payment-preview"
          >
            <p className="text-muted-foreground">
              {fmt(t.dialog.periodStart, {
                from: formatDate(period.start, today, locale),
              })}
            </p>
            {showEndError ? (
              <p className="text-destructive">
                {fmt(t.dialog.periodEndError, {
                  min: formatDate(bounds.min, today, locale),
                  max: formatDate(bounds.max, today, locale),
                })}
              </p>
            ) : endChanged ? (
              <p className="text-muted-foreground">
                {fmt(t.dialog.periodEndChanged, {
                  date: formatDate(period.end, today, locale),
                })}
              </p>
            ) : null}
          </div>
          {endChanged ? (
            <button
              type="button"
              className={`${buttonVariants({ variant: "outline" })} self-start`}
              onClick={() => setEndText(period.end)}
              data-testid="payment-period-reset"
            >
              {t.dialog.periodReset}
            </button>
          ) : null}
        </div>
      </form>
    </ResponsiveDialog>
  );
}
