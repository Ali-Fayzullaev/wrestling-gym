import type { Locale } from "@/lib/locale";

import type { ReminderKind, ReminderStatus } from "./kinds";

/** Errors a reminder action can report to the screen: codes only, never internal details. */
export type ReminderError =
  "forbidden" | "not_found" | "invalid" | "unavailable";

export type ReminderResult<T> =
  { ok: true; data: T } | { ok: false; error: ReminderError };

/** What record_reminder_opened() returns. */
export type OpenedReminder = {
  id: string;
  clientId: string;
  /** ISO instant the chat was first opened (an earlier click wins). */
  openedAt: string;
  status: ReminderStatus;
  /** false when an event of this kind already existed for the subscription. */
  created: boolean;
};

/** What mark_reminder_sent() returns. */
export type MarkedReminder = {
  id: string;
  status: ReminderStatus;
  markedSentAt: string | null;
  /** false when it was already marked. */
  changed: boolean;
};

/** Which form fields failed, for messages next to them. */
export type SettingsFieldErrors = {
  firstDays?: true;
  secondDays?: true;
  /** Template ids with a bad text. */
  templates?: string[];
};

export type SettingsResult =
  | { ok: true; daysChanged: boolean; templatesChanged: number }
  | { ok: false; error: ReminderError; fields?: SettingsFieldErrors };

/**
 * Arguments of the "chat opened" action: which subscription, which reminder and the language it
 * went out in (D-17; absent means the client's language from the card).
 */
export type OpenReminderInput = {
  paymentId: string;
  kind: ReminderKind;
  locale?: Locale;
};
