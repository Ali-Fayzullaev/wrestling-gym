import type * as React from "react";

/** Screen title (the page's only h1), an optional hint, and the screen's actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {/* Never wider than the screen: a row of several actions wraps instead of scrolling. */}
      {actions ? (
        <div className="flex max-w-full min-w-0 gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
