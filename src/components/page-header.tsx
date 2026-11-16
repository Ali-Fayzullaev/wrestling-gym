import type * as React from "react";

import type { MascotMood } from "@/lib/mascot";

import { FirstScreenMascot } from "./first-screen-mascot";

/**
 * Screen title (the page's only h1), an optional hint, and the screen's actions. Main screens
 * show the mascot next to the title, in the mood of the screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  mascot,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  mascot?: MascotMood;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {mascot ? (
          <FirstScreenMascot
            mood={mascot}
            size={56}
            className="size-12 md:size-14"
          />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {/* Never wider than the screen: a row of several actions wraps instead of scrolling. */}
      {actions ? (
        <div className="flex max-w-full min-w-0 gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
