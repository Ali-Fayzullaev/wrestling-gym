import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { ru } from "@/i18n/ru";

/** Values of client_status().status in the database. */
export type SubscriptionStatus = keyof typeof ru.status;

const STYLES: Record<
  SubscriptionStatus,
  { icon: LucideIcon; className: string }
> = {
  active: {
    icon: CircleCheck,
    className: "bg-status-active text-status-active-foreground",
  },
  expiring: {
    icon: Clock,
    className: "bg-status-expiring text-status-expiring-foreground",
  },
  expired: {
    icon: CircleAlert,
    className: "bg-status-expired text-status-expired-foreground",
  },
  none: {
    icon: CircleDashed,
    className: "bg-status-none text-status-none-foreground",
  },
};

/** Status by colour, icon and word: never by colour alone. */
export function StatusBadge({
  status,
  className,
}: {
  status: SubscriptionStatus;
  className?: string;
}) {
  const { icon: Icon, className: tone } = STYLES[status];
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {ru.status[status]}
    </span>
  );
}
