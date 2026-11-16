import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

import { formatWhen } from "../labels";
import type { ReminderEvent } from "../service";

/** Reminder history on the client card: kind, when the chat was opened, and the manual mark. */
export async function ReminderHistoryList({
  events,
  now,
}: {
  events: ReminderEvent[];
  now: Date;
}) {
  const { t, locale } = await getI18n();
  const r = t.reminders;
  return (
    <ul
      className="flex flex-col divide-y rounded-xl border bg-card"
      data-testid="reminder-history"
    >
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
          <p className="font-medium">{r.kindShort[event.kind]}</p>
          <p className="text-muted-foreground">
            {fmt(r.chatOpenedAt, {
              when: formatWhen(event.openedAt, now, locale),
            })}
            {" · "}
            {fmt(r.openedBy, { by: event.openedByName })}
          </p>
          {event.status === "marked_sent" && event.markedSentAt ? (
            <p className="text-status-active-foreground">
              {fmt(r.markedSent, {
                when: formatWhen(event.markedSentAt, now, locale),
                by: event.markedSentByName ?? "",
              })}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
