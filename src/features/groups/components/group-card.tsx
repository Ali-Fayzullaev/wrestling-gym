import { CalendarDays, ChevronRight, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { groupsText } from "@/i18n/groups";

import { formatSchedule, formatSeats, seatState } from "../format";
import type { GroupSummary } from "../service";

/** One group on the list: who coaches, when, how full, and how many have paid or owe. */
export function GroupCard({ group }: { group: GroupSummary }) {
  const seats = seatState(group.members, group.capacity);
  return (
    <Link
      href={`/groups/${group.id}`}
      data-testid="group-card"
      className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-base font-semibold break-words">{group.name}</h2>
          <p className="text-sm text-muted-foreground">{group.coachName}</p>
        </div>
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </div>
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{formatSchedule(group.schedule)}</span>
      </p>
      <GroupCountsRow
        seats={formatSeats(group.members, group.capacity)}
        over={seats === "over"}
        paid={group.paid}
        debtors={group.debtors}
      />
    </Link>
  );
}

/** Seats, paid and debtors as a definition list, so each number is read with its label. */
export function GroupCountsRow({
  seats,
  over,
  paid,
  debtors,
}: {
  seats: string;
  over: boolean;
  paid: number;
  debtors: number;
}) {
  return (
    <dl className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground">{groupsText.seats}</dt>
        <dd
          className="flex items-center gap-1 font-semibold tabular-nums"
          data-testid="group-seats"
        >
          {over ? (
            <TriangleAlert
              aria-label={groupsText.overCapacity}
              className="size-4 text-status-expiring-foreground"
            />
          ) : null}
          {seats}
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground">{groupsText.paid}</dt>
        <dd className="font-semibold tabular-nums" data-testid="group-paid">
          {paid}
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground">{groupsText.debtors}</dt>
        <dd className="font-semibold tabular-nums" data-testid="group-debtors">
          {debtors}
        </dd>
      </div>
    </dl>
  );
}
