import type { Locale } from "@/lib/locale";

import type { TodayRow } from "../service";
import { ClientSummaryLink } from "./client-summary-link";

/** "Paid today": who paid and until when. Nothing to act on here, so no client code. */
export function PaidList({
  rows,
  today,
  locale,
  labels,
}: {
  rows: TodayRow[];
  today: Date;
  locale: Locale;
  labels: { noGroup: string; endsOn: string };
}) {
  return (
    <ul
      className="flex flex-col divide-y rounded-xl border bg-card"
      data-testid="paid-list"
    >
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex min-h-16 flex-col justify-center px-4 py-2.5"
          data-testid="paid-row"
        >
          <ClientSummaryLink
            row={row}
            today={today}
            locale={locale}
            labels={labels}
          />
        </li>
      ))}
    </ul>
  );
}
