"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { paymentsText as t } from "@/i18n/payments";
import { ru } from "@/i18n/ru";

import { REASON_MAX } from "../form-fields";
import type { PaymentError, PaymentResult, RecordedPayment } from "../result";
import type { CancelPayment } from "./payment-dialog";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

export type ReversalMode = "cancel" | "reverse";

export type ReversePayment = (input: {
  paymentId: string;
  reason: string;
  idempotencyKey: string;
}) => Promise<PaymentResult<RecordedPayment>>;

/**
 * Asks before cancelling a payment (no reason: "cancelled right away") or reversing it (the owner,
 * a reason is required). One key per opened dialog, so a double tap records one reversal.
 */
export default function ReversePaymentDialog({
  paymentId,
  mode,
  open,
  onOpenChange,
  cancel,
  reverse,
}: {
  paymentId: string;
  mode: ReversalMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cancel: CancelPayment;
  reverse: ReversePayment;
}) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const texts = mode === "cancel" ? t.cancelDialog : t.reverseDialog;
  const reasonMissing = mode === "reverse" && reason.trim() === "";

  function confirm() {
    setTouched(true);
    if (reasonMissing || pending) return;
    startTransition(async () => {
      let result:
        PaymentResult<RecordedPayment> | { ok: false; error: "network" };
      try {
        result =
          mode === "cancel"
            ? await cancel({ paymentId, idempotencyKey: key })
            : await reverse({ paymentId, reason, idempotencyKey: key });
      } catch {
        result = { ok: false, error: "network" };
      }
      if (!result.ok) {
        const code: PaymentError | "network" = result.error;
        setError(code === "network" ? t.network : t.errors[code]);
        return;
      }
      setError(null);
      toast.success(texts.done);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title={texts.title}
      description={texts.text}
      footer={
        <>
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {mode === "cancel" ? t.cancelDialog.keep : ru.common.cancel}
          </button>
          <button
            type="button"
            className={buttonVariants({ variant: "destructive" })}
            onClick={confirm}
            disabled={pending}
            data-testid="reversal-confirm"
          >
            {texts.confirm}
          </button>
        </>
      }
    >
      {mode === "reverse" ? (
        <div className="flex flex-col gap-1.5 py-2">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            {t.reverseDialog.reason}
          </label>
          <textarea
            id={`${id}-reason`}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            placeholder={t.reverseDialog.reasonPlaceholder}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={(touched && reasonMissing) || undefined}
            aria-describedby={
              touched && reasonMissing ? `${id}-reason-error` : undefined
            }
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
          />
          {touched && reasonMissing ? (
            <p id={`${id}-reason-error`} className="text-sm text-destructive">
              {t.reverseDialog.reasonError}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="my-1 rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
        >
          {error}
        </p>
      ) : null}
    </ResponsiveDialog>
  );
}
