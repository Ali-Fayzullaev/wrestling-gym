import Link from "next/link";

import { DateText } from "@/components/date-text";

import type { TodayRow } from "../service";

/**
 * Name, group and end date of a Today row; the whole block opens the client card, so the tap
 * target is at least 44 px tall. No class merging: the reminder island uses it too.
 */
export function ClientSummaryLink({
  row,
  today,
  labels,
}: {
  row: TodayRow;
  today: Date;
  labels: { noGroup: string; endsOn: string };
}) {
  return (
    <Link
      href={`/clients/${row.id}`}
      className="group flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <span className="truncate font-medium underline-offset-4 group-hover:underline">
        {row.name}
      </span>
      <span className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
        <span>{row.groupName ?? labels.noGroup}</span>
        {row.endsOn ? (
          <span>
            {labels.endsOn}: <DateText date={row.endsOn} today={today} />
          </span>
        ) : null}
      </span>
    </Link>
  );
}
