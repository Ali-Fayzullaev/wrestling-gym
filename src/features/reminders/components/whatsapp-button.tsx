"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { formatTime } from "@/lib/format";

import type {
  OpenedReminder,
  OpenReminderInput,
  ReminderResult,
} from "../result";

export type OpenReminder = (
  input: OpenReminderInput,
) => Promise<ReminderResult<OpenedReminder>>;

export type WhatsAppLabels = {
  whatsapp: string;
  /** Followed by the time: "Чат открыт 14:32". */
  chatOpened: string;
  recordFailed: string;
  retry: string;
};

// A phone that just switched to WhatsApp may suspend this tab mid-request; waiting a little and
// trying again usually gets the event through once the page is back.
const RETRY_DELAYS_MS = [1000, 3000, 9000];

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries only a failed request (network); an answer from the server, even "no", is final. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      await pause(delay);
    }
  }
}

type State =
  | { phase: "idle" }
  | { phase: "opened"; at: Date }
  | { phase: "failed"; at: Date };

/**
 * Opens the wa.me chat and records "chat opened". The link is a plain anchor, so the browser opens
 * it within the click and never blocks it as a popup; the record goes out in parallel. Once saved,
 * the server re-renders the screen, so the row leaves "Remind today" and its counter by itself.
 * Lives inside a two-column grid: the caption takes the full row under the buttons.
 */
export function WhatsAppButton({
  href,
  target,
  labels,
  open,
  variant = "default",
}: {
  href: string;
  target: OpenReminderInput;
  labels: WhatsAppLabels;
  open: OpenReminder;
  variant?: "default" | "outline";
}) {
  const [state, setState] = useState<State>({ phase: "idle" });

  async function record(at: Date) {
    setState({ phase: "opened", at });
    try {
      const result = await withRetry(() => open(target));
      setState(
        result.ok
          ? { phase: "opened", at: new Date(result.data.openedAt) }
          : { phase: "failed", at },
      );
    } catch {
      setState({ phase: "failed", at });
    }
  }

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant })}
        onClick={() => void record(new Date())}
        data-testid="whatsapp-button"
      >
        <MessageCircle aria-hidden />
        {labels.whatsapp}
      </a>
      <div
        role="status"
        className="order-last col-span-2 text-sm empty:hidden"
        data-testid="whatsapp-status"
      >
        {state.phase === "idle" ? null : (
          <p className="text-muted-foreground">
            {labels.chatOpened}{" "}
            <span className="tabular-nums">{formatTime(state.at)}</span>
          </p>
        )}
        {state.phase === "failed" ? (
          <p className="flex flex-wrap items-center gap-x-2 text-status-expired-foreground">
            {labels.recordFailed}
            <button
              type="button"
              className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              onClick={() => void record(state.at)}
            >
              {labels.retry}
            </button>
          </p>
        ) : null}
      </div>
    </>
  );
}
