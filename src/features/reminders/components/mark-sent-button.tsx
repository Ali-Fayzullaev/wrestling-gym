"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/variants";

import type { MarkedReminder, ReminderResult } from "../result";
import type { MarkReminderSentInput } from "../schema";

export type MarkReminderSent = (
  input: MarkReminderSentInput,
) => Promise<ReminderResult<MarkedReminder>>;

/**
 * The manual "marked as sent": only the employee knows the message went out. After it is saved the
 * server re-renders the row with who marked it and when.
 */
export function MarkSentButton({
  eventId,
  labels,
  mark,
}: {
  eventId: string;
  labels: { markSent: string; marking: string; failed: string };
  mark: MarkReminderSent;
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
              const result = await mark({ eventId });
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
