import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { getI18n } from "@/i18n/server";
import { formatMonth } from "@/lib/format";

import { FIRST_MONTH, shiftMonth } from "../month";

const ARROW =
  "inline-flex size-11 items-center justify-center rounded-full border transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring";

/**
 * Previous and next month as links: the month lives in the address, so back works and the screen
 * needs no client code. No next month past the current one.
 */
export async function MonthNav({
  month,
  current,
}: {
  month: string;
  current: string;
}) {
  const { t: messages, locale } = await getI18n();
  const t = messages.reports.monthNav;
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <nav aria-label={t.label} className="flex items-center gap-2">
      {previous >= FIRST_MONTH ? (
        <Link
          href={`/reports?month=${previous}`}
          aria-label={t.previous}
          className={ARROW}
          replace
          scroll={false}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
      ) : (
        <span aria-hidden className={`${ARROW} opacity-40`}>
          <ChevronLeft className="size-5" />
        </span>
      )}
      <p
        className="min-w-36 text-center text-base font-semibold"
        aria-live="polite"
        data-testid="report-month"
      >
        {formatMonth(month, locale)}
      </p>
      {next <= current ? (
        <Link
          href={`/reports?month=${next}`}
          aria-label={t.next}
          className={ARROW}
          replace
          scroll={false}
        >
          <ChevronRight aria-hidden className="size-5" />
        </Link>
      ) : (
        <span aria-hidden className={`${ARROW} opacity-40`}>
          <ChevronRight className="size-5" />
        </span>
      )}
    </nav>
  );
}
