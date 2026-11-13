import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** A counter that opens the list it counts. The number is counted in Postgres, not here. */
export function StatCard({
  label,
  value,
  href,
  emphasis = false,
}: {
  label: string;
  value: number;
  href: string;
  /** Draws attention when the count needs action (debts, expiring today). */
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-card p-4 text-card-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring",
        emphasis && value > 0 && "border-l-4 border-l-primary",
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-3xl font-semibold tabular-nums">{value}</span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
