import type * as React from "react";

import type { MascotMood } from "@/lib/mascot";

import { Mascot } from "./mascot";

/**
 * What will appear here and what to do about it, with the action as a button. The mascot's mood
 * matches the situation: calm when there is nothing to do, a magnifier when nothing was found.
 */
export function EmptyState({
  mood,
  title,
  description,
  action,
  compact = false,
}: {
  mood: MascotMood;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Inside a card section: a smaller mascot and less padding. */
  compact?: boolean;
}) {
  return (
    <section
      data-testid="empty-state"
      className={`flex flex-col items-center gap-3 rounded-xl border border-dashed text-center ${
        compact ? "px-4 py-6" : "px-6 py-8"
      }`}
    >
      <Mascot
        mood={mood}
        size={compact ? 72 : 112}
        className="motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in-0 motion-safe:zoom-in-95"
      />
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
