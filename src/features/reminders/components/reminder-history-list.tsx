import { remindersText as r } from "@/i18n/reminders";

import { formatWhen } from "../labels";
import type { ReminderEvent } from "../service";

/** Reminder history on the client card: kind, when the chat was opened, and the manual mark. */
export function ReminderHistoryList({
  events,
  now,
}: {
  events: ReminderEvent[];
  now: Date;
}) {
  return (
    <ul
      className="flex flex-col divide-y rounded-xl border bg-card"
      data-testid="reminder-history"
    >
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
          <p className="font-medium">{r.kindShort[event.kind]}</p>
          <p className="text-muted-foreground">
            {r.chatOpenedAt(formatWhen(event.openedAt, now))}
            {" · "}
            {r.openedBy(event.openedByName)}
          </p>
          {event.status === "marked_sent" && event.markedSentAt ? (
            <p className="text-status-active-foreground">
              {r.markedSent(
                formatWhen(event.markedSentAt, now),
                event.markedSentByName ?? "",
              )}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
