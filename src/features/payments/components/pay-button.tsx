"use client";

import { Wallet } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";

import type {
  CancelPayment,
  PaymentTarget,
  RecordPayment,
} from "./payment-dialog";

const loadDialog = () => import("./payment-dialog");
const PaymentDialog = lazy(loadDialog);

/**
 * "Paid" on the client card; the dialog loads on first intent, the card refreshes on success.
 * The label comes from the server so the texts of the dialog stay out of the card's first load.
 */
export function PayButton({
  label,
  target,
  today,
  record,
  cancel,
}: {
  label: string;
  target: PaymentTarget;
  today: Date;
  record: RecordPayment;
  cancel: CancelPayment;
}) {
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonVariants()}
        onPointerEnter={() => void loadDialog()}
        onFocus={() => void loadDialog()}
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
        data-testid="pay-button"
      >
        <Wallet aria-hidden />
        {label}
      </button>
      {requested ? (
        <Suspense fallback={null}>
          <PaymentDialog
            target={target}
            today={today}
            open={open}
            onOpenChange={setOpen}
            record={record}
            cancel={cancel}
          />
        </Suspense>
      ) : null}
    </>
  );
}
