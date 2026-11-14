"use client";

import { lazy, Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";

import type { CancelPayment } from "./payment-dialog";
import type { ReversalMode, ReversePayment } from "./reverse-payment-dialog";

const loadDialog = () => import("./reverse-payment-dialog");
const ReversePaymentDialog = lazy(loadDialog);

/**
 * "Cancel" (author or owner, first 10 minutes) and "Reversal" (owner) on one history entry. Both
 * ask first; the server checks the role and the clock again. Labels come from the server so the
 * dialog texts load only with the dialog.
 */
export function PaymentEntryActions({
  paymentId,
  cancelLabel,
  reverseLabel,
  cancel,
  reverse,
}: {
  paymentId: string;
  /** Shown when the employee may cancel this payment now. */
  cancelLabel: string | null;
  /** Shown when the employee may reverse it (the owner). */
  reverseLabel: string | null;
  cancel: CancelPayment;
  reverse: ReversePayment;
}) {
  const [mode, setMode] = useState<ReversalMode | null>(null);
  const [requested, setRequested] = useState<ReversalMode | null>(null);

  const button = (value: ReversalMode, label: string) => (
    <button
      type="button"
      className={buttonVariants({ variant: "outline" })}
      onPointerEnter={() => void loadDialog()}
      onFocus={() => void loadDialog()}
      onClick={() => {
        setRequested(value);
        setMode(value);
      }}
      data-testid={`payment-${value}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {cancelLabel ? button("cancel", cancelLabel) : null}
      {reverseLabel ? button("reverse", reverseLabel) : null}
      {requested ? (
        <Suspense fallback={null}>
          <ReversePaymentDialog
            paymentId={paymentId}
            mode={requested}
            open={mode !== null}
            onOpenChange={(next) => {
              if (!next) setMode(null);
            }}
            cancel={cancel}
            reverse={reverse}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
