import { cn } from "@/lib/utils";

import { formatMoney } from "@/lib/format";
import type { Locale } from "@/lib/locale";

/** An amount in tenge, aligned in columns: <Money amount={25000} locale="ru" /> shows "25 000 ₸". */
export function Money({
  amount,
  locale,
  className,
}: {
  amount: number;
  locale: Locale;
  className?: string;
}) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {formatMoney(amount, locale)}
    </span>
  );
}
