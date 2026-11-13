import { cn } from "@/lib/utils";

import { formatMoney } from "@/lib/format";

/** An amount in tenge, aligned in columns: <Money amount={25000} /> shows "25 000 ₸". */
export function Money({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {formatMoney(amount)}
    </span>
  );
}
