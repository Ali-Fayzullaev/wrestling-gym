import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";

import { DateText } from "@/components/date-text";
import { Money } from "@/components/money";
import { reportsText } from "@/i18n/reports";

import type { DebtorGroup } from "../result";

const t = reportsText.debtors;

/**
 * Debtors by group, each group folded into a native <details> (no client code): the head says how
 * many and how much is expected at the group's price, the body lists who, linked to the card.
 */
export function DebtorsList({
  groups,
  today,
}: {
  groups: readonly DebtorGroup[];
  today: Date;
}) {
  return (
    <ul
      className="flex flex-col divide-y rounded-xl border bg-card"
      data-testid="debtor-groups"
    >
      {groups.map((group) => (
        <li key={group.groupId ?? "none"} data-testid="debtor-group">
          <details className="group/details">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-180 motion-reduce:transition-none"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium break-words">
                  {group.name ?? reportsText.noGroup}
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t.count(group.count)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end text-sm">
                <span className="text-muted-foreground">{t.expected}</span>
                {group.price === null ? (
                  <span className="text-muted-foreground">{t.noPrice}</span>
                ) : (
                  <Money amount={group.expected} className="font-semibold" />
                )}
              </span>
            </summary>
            <ul className="flex flex-col divide-y border-t">
              {group.clients.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex min-h-12 items-center gap-3 px-4 py-2 pl-11 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="break-words">{client.name}</span>
                      {client.endsOn ? (
                        <span className="text-muted-foreground">
                          {t.endedOn}{" "}
                          <DateText date={client.endsOn} today={today} />
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}
