"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/variants";

import type { MarkedFamily, MarkedReminder, ReminderResult } from "../result";
import type { MarkFamilySentInput, MarkReminderSentInput } from "../schema";

export type MarkReminderSent = (
  input: MarkReminderSentInput,
) => Promise<ReminderResult<MarkedReminder>>;

/** "Sent" for every child of one family message at once (D-18). */
export type MarkFamilySent = (
  input: MarkFamilySentInput,
) => Promise<ReminderResult<MarkedFamily>>;

/**
 * The manual "marked as sent": only the employee knows the message went out. After it is saved the
 * server re-renders the row with who marked it and when. One event, or every child of a family
 * message still to mark.
 */
export function MarkSentButton<Input>({
  input,
  labels,
  mark,
}: {
  input: Input;
  labels: { markSent: string; marking: string; failed: string };
  mark: (input: Input) => Promise<ReminderResult<unknown>>;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonVariants({ variant: "outline" })}
        disabled={pending}
        onClick={() => {
          setFailed(false);
          startTransition(async () => {
            try {
              const result = await mark(input);
              if (!result.ok) setFailed(true);
            } catch {
              setFailed(true);
            }
          });
        }}
        data-testid="mark-sent-button"
      >
        <Check aria-hidden />
        {pending ? labels.marking : labels.markSent}
      </button>
      <p
        role="status"
        className="order-last col-span-2 text-sm text-status-expired-foreground empty:hidden"
      >
        {failed ? labels.failed : null}
      </p>
    </>
  );
}
