import type { LucideIcon } from "lucide-react";
import type * as React from "react";

/** What will appear here and what to do about it, with the action as a button. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-6" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </section>
  );
}
