import { groupsText } from "@/i18n/groups";

import type { Session } from "./schema";

const EN_DASH = "–";

/**
 * "Пн, Ср, Пт 09:00–10:00 · Сб 11:00–12:00": days that share a time are listed together, in the
 * order of their first day.
 */
export function formatSchedule(sessions: readonly Session[]): string {
  if (sessions.length === 0) return groupsText.noSchedule;
  const byTime = new Map<string, number[]>();
  for (const session of [...sessions].sort((a, b) => a.day - b.day)) {
    const time = `${session.start}${EN_DASH}${session.end}`;
    byTime.set(time, [...(byTime.get(time) ?? []), session.day]);
  }
  return [...byTime]
    .map(
      ([time, days]) =>
        `${days.map((day) => groupsText.daysShort[day - 1]).join(", ")} ${time}`,
    )
    .join(" · ");
}

export type SeatState = "unlimited" | "free" | "full" | "over";

/** Fill level against the seat limit; "over" is allowed but shown as a warning. */
export function seatState(members: number, capacity: number | null): SeatState {
  if (capacity === null) return "unlimited";
  if (members > capacity) return "over";
  if (members === capacity) return "full";
  return "free";
}

/** "24 / 30", or just "24" when the group has no seat limit. */
export function formatSeats(members: number, capacity: number | null): string {
  return capacity === null ? String(members) : `${members} / ${capacity}`;
}
