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

/** What mark_family_reminders_sent() did: how many children it marked now (0 on a repeat). */
export type MarkedFamily = { changed: number };

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

/** One child's reminder: which subscription and which reminder. */
export type SingleReminderTarget = { paymentId: string; kind: ReminderKind };

/**
 * One message to a parent about several children (D-18): "chat opened" is recorded for each of
 * them.
 */
export type FamilyReminderTarget = {
  parentId: string;
  items: SingleReminderTarget[];
};

export type ReminderTargetInput = SingleReminderTarget | FamilyReminderTarget;

/**
 * Arguments of the "chat opened" action: what the message was about and the language it went out
 * in (D-17; absent means the language on the card: the parent's for a child).
 */
export type OpenReminderInput = ReminderTargetInput & { locale?: Locale };

export function isFamilyTarget(
  target: ReminderTargetInput,
): target is FamilyReminderTarget {
  return "parentId" in target;
}
