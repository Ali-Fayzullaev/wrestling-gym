import { z } from "zod";

import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";
import { businessDate } from "@/lib/dates";
import { LOCALES, type Locale } from "@/lib/locale";
import { buildWaLink } from "@/lib/whatsapp";

import {
  REMINDER_KINDS,
  type ReminderKind,
  type ReminderStatus,
} from "./kinds";
import type {
  MarkedReminder,
  OpenedReminder,
  OpenReminderInput,
  ReminderError,
  ReminderResult,
  SettingsResult,
} from "./result";
import {
  type HistoryFilter,
  type MarkReminderSentInput,
  reminderDaysOf,
  type ReminderSettingsInput,
} from "./schema";
import {
  isDraftTemplate,
  pickTemplate,
  type ReminderContact,
  type ReminderTemplate,
  reminderValues,
  renderTemplate,
} from "./template";

// Shapes of the jsonb the reminder functions return (supabase/migrations/*_reminders.sql), checked
// rather than trusted.
const kindShape = z.enum(REMINDER_KINDS);
const statusShape = z.enum(["chat_opened", "marked_sent"]);
const localeShape = z.enum(LOCALES);

const contextShape = z.object({
  gym_name: z.string().nullable(),
  reminder_days: z.array(z.number()).nullable(),
  templates: z.array(
    z.object({
      id: z.string(),
      kind: kindShape,
      locale: localeShape,
      body: z.string(),
      edited: z.boolean(),
    }),
  ),
});

const contactShape = z.object({
  id: z.string(),
  last_name: z.string(),
  first_name: z.string(),
  phone: z.string(),
  phone_owner: z.enum(["self", "parent"]),
  parent_name: z.string().nullable(),
  message_locale: localeShape,
  group_name: z.string().nullable(),
  price: z.number().nullable(),
  payment_id: z.string(),
  kind: kindShape.nullable(),
  ends_on: z.string().nullable(),
});

const eventShape = z.object({
  id: z.string(),
  client_id: z.string(),
  payment_id: z.string(),
  kind: kindShape,
  status: statusShape,
  opened_at: z.string(),
  opened_by_name: z.string(),
  marked_sent_at: z.string().nullable(),
  marked_sent_by_name: z.string().nullable(),
});

const namedEventShape = eventShape.extend({
  last_name: z.string(),
  first_name: z.string(),
});

export type { ReminderTemplate };

export type ReminderContext = {
  gymName: string;
  /** settings.reminder_days: the early reminder first, one or two values. */
  reminderDays: number[];
  templates: ReminderTemplate[];
};

/** Fields a wa.me reminder link is built from, as screens pass them around. */
export type LinkContact = ReminderContact & { phone: string };

/** A client to remind with a ready wa.me link. */
export type ReminderTarget = {
  clientId: string;
  name: string;
  groupName: string | null;
  endsOn: string | null;
  paymentId: string;
  kind: ReminderKind;
  /** wa.me link with the filled-in text; null when the template of this kind is missing. */
  href: string | null;
};

export type ReminderEvent = {
  id: string;
  clientId: string;
  paymentId: string;
  kind: ReminderKind;
  status: ReminderStatus;
  openedAt: string;
  openedByName: string;
  markedSentAt: string | null;
  markedSentByName: string | null;
};

export type NamedReminderEvent = ReminderEvent & { name: string };

export type RemindersToday = {
  reminderDays: number[];
  /** Due today and not opened yet: the same rows as "Remind today" on the Today screen. */
  due: ReminderTarget[];
  /** Chats opened today, newest first. */
  opened: NamedReminderEvent[];
};

export type OverdueTarget = ReminderTarget & { event: ReminderEvent | null };

export type RemindersOverdue = {
  overdue: OverdueTarget[];
};

export type ReminderHistory = {
  events: NamedReminderEvent[];
  staff: { id: string; name: string }[];
};

export type ReminderSettingsScreen = {
  context: ReminderContext;
  /** A real current client to preview the texts on, or null when there is none. */
  preview: (ReminderContact & { name: string }) | null;
};

// STUB(D-05): the shipped defaults, used only if the settings row cannot be read.
const DEFAULT_DAYS = [7, 1];
/** Rows a history or overdue tab shows at most. */
export const HISTORY_LIMIT = 300;

export function parseReminderContext(raw: unknown): ReminderContext {
  const context = contextShape.parse(raw);
  return {
    gymName: context.gym_name ?? "",
    reminderDays: context.reminder_days ?? DEFAULT_DAYS,
    templates: context.templates,
  };
}

/** A reminder as the client will read it: the text and the language it is written in. */
export type ReminderText = {
  text: string;
  /** The template's language: the one asked for, or Russian when it has no template. */
  locale: Locale;
  /** A shipped Kazakh or Uzbek text nobody has edited: the screens mark it "draft". */
  draft: boolean;
};

/**
 * The text of a reminder of `kind` for this client: the template of that kind in `locale` (the
 * client's language unless the sender chose another, D-17), or the Russian one, filled with the
 * client's data in the template's language.
 */
export function buildReminderText(
  contact: ReminderContact,
  kind: ReminderKind,
  context: ReminderContext,
  today: Date,
  locale: Locale = contact.messageLocale,
): ReminderText | null {
  const template = pickTemplate(context.templates, kind, locale);
  if (!template) return null;
  return {
    text: renderTemplate(
      template.body,
      reminderValues(contact, context.gymName, today, template.locale),
    ),
    locale: template.locale,
    draft: isDraftTemplate(template),
  };
}

/** One reminder in one language, with its ready wa.me link. */
export type ReminderVariant = ReminderText & { href: string };

/**
 * A reminder in every language the sender may pick (D-17). The texts are built on the server, so
 * switching the language in the browser needs neither the template code nor a database request.
 */
export type ReminderMessage = {
  /** The client's language from the card: picked first. */
  defaultLocale: Locale;
  variants: Record<Locale, ReminderVariant>;
};

/**
 * The reminder of `kind` in ru, kk and uz. Null when a language has no text even in Russian; the
 * database keeps a template of every kind in every language (step 19), so only a broken install
 * gets here.
 */
export function buildReminderMessage(
  contact: LinkContact,
  kind: ReminderKind,
  context: ReminderContext,
  today: Date,
): ReminderMessage | null {
  const variant = (locale: Locale): ReminderVariant | null => {
    const reminder = buildReminderText(contact, kind, context, today, locale);
    return (
      reminder && {
        ...reminder,
        href: buildWaLink(contact.phone, reminder.text),
      }
    );
  };
  const [ru, kk, uz] = [variant("ru"), variant("kk"), variant("uz")];
  if (!ru || !kk || !uz) return null;
  return { defaultLocale: contact.messageLocale, variants: { ru, kk, uz } };
}

/**
 * The wa.me link for a reminder of `kind` with the text of buildReminderText(). Built on the
 * server, so the template code never ships to the browser.
 */
export function buildReminderLink(
  contact: LinkContact,
  kind: ReminderKind,
  context: ReminderContext,
  today: Date,
): string | null {
  const reminder = buildReminderText(contact, kind, context, today);
  return reminder ? buildWaLink(contact.phone, reminder.text) : null;
}

function toLinkContact(row: z.infer<typeof contactShape>): LinkContact {
  return {
    firstName: row.first_name,
    phoneOwner: row.phone_owner,
    parentName: row.parent_name,
    messageLocale: row.message_locale,
    groupName: row.group_name,
    price: row.price,
    endsOn: row.ends_on,
    phone: row.phone,
  };
}

function toTarget(
  row: z.infer<typeof contactShape>,
  kind: ReminderKind,
  context: ReminderContext,
  today: Date,
): ReminderTarget {
  return {
    clientId: row.id,
    name: `${row.last_name} ${row.first_name}`,
    groupName: row.group_name,
    endsOn: row.ends_on,
    paymentId: row.payment_id,
    kind,
    href: buildReminderLink(toLinkContact(row), kind, context, today),
  };
}

function toEvent(row: z.infer<typeof eventShape>): ReminderEvent {
  return {
    id: row.id,
    clientId: row.client_id,
    paymentId: row.payment_id,
    kind: row.kind,
    status: row.status,
    openedAt: row.opened_at,
    openedByName: row.opened_by_name,
    markedSentAt: row.marked_sent_at,
    markedSentByName: row.marked_sent_by_name,
  };
}

export function parseReminderEvents(raw: unknown): ReminderEvent[] {
  return z.array(eventShape).parse(raw).map(toEvent);
}

function toNamedEvent(
  row: z.infer<typeof namedEventShape>,
): NamedReminderEvent {
  return { ...toEvent(row), name: `${row.last_name} ${row.first_name}` };
}

async function screenTab(
  db: Db,
  now: Date,
  tab: "today" | "overdue" | "history",
  filter: HistoryFilter = {},
): Promise<unknown> {
  const { data, error } = await db.rpc("reminders_screen", {
    p_tab: tab,
    p_today: businessDate(now),
    p_date: filter.date,
    p_staff_id: filter.staff,
    p_limit: HISTORY_LIMIT,
  });
  if (error) throw new Error(`reminders_screen failed: ${error.code}`);
  return data;
}

/** "Today" tab: due reminders with links and the chats opened today. One database request. */
export async function getRemindersToday(
  db: Db,
  now: Date,
): Promise<RemindersToday> {
  const screen = z
    .object({
      context: z.unknown(),
      due: z.array(contactShape.extend({ kind: kindShape })),
      opened: z.array(namedEventShape),
    })
    .parse(await screenTab(db, now, "today"));
  const context = parseReminderContext(screen.context);
  return {
    reminderDays: context.reminderDays,
    due: screen.due.map((row) => toTarget(row, row.kind, context, now)),
    opened: screen.opened.map(toNamedEvent),
  };
}

/** "Overdue" tab: ended subscriptions, each with its "overdue" reminder link and event. */
export async function getRemindersOverdue(
  db: Db,
  now: Date,
): Promise<RemindersOverdue> {
  const screen = z
    .object({
      context: z.unknown(),
      overdue: z.array(contactShape.extend({ event: eventShape.nullable() })),
    })
    .parse(await screenTab(db, now, "overdue"));
  const context = parseReminderContext(screen.context);
  return {
    overdue: screen.overdue.map((row) => ({
      ...toTarget(row, "overdue", context, now),
      event: row.event ? toEvent(row.event) : null,
    })),
  };
}

/** "History" tab: events of one day (today by default), optionally of one employee. */
export async function getReminderHistory(
  db: Db,
  now: Date,
  filter: HistoryFilter,
): Promise<ReminderHistory> {
  const screen = z
    .object({
      events: z.array(namedEventShape),
      staff: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .parse(await screenTab(db, now, "history", filter));
  return {
    events: screen.events.map(toNamedEvent),
    staff: screen.staff,
  };
}

/** The owner's settings screen: days, templates and a client to preview them on. */
export async function getReminderSettings(
  db: Db,
  now: Date,
): Promise<ReminderSettingsScreen> {
  const { data, error } = await db.rpc("reminder_settings_screen", {
    p_today: businessDate(now),
  });
  if (error) throw new Error(`reminder_settings_screen failed: ${error.code}`);
  const screen = z
    .object({ context: z.unknown(), preview: contactShape.nullable() })
    .parse(data);
  return {
    context: parseReminderContext(screen.context),
    preview: screen.preview && {
      ...toLinkContact(screen.preview),
      name: `${screen.preview.last_name} ${screen.preview.first_name}`,
    },
  };
}

const MESSAGE_ERRORS: Record<string, ReminderError> = {
  payment_not_found: "not_found",
  template_not_found: "not_found",
  reminder_not_found: "not_found",
};

/** Postgres errors raised by the reminder functions, mapped to what the screen can say. */
export function reminderError(error: {
  code?: string;
  message?: string;
}): ReminderError {
  const known = error.message ? MESSAGE_ERRORS[error.message] : undefined;
  if (known) return known;
  if (error.code === "42501") return "forbidden";
  if (
    error.code === "22023" ||
    error.code === "23514" ||
    error.code === "22P02"
  ) {
    return "invalid";
  }
  return "unavailable";
}

const isStaff = (actor: Actor) =>
  actor.role === "owner" || actor.role === "admin";

/**
 * Records "chat opened" for this subscription and reminder kind. Repeating it (a second click, a
 * network retry, another tab) returns the first event: the database key allows only one.
 */
export async function openReminder(
  db: Db,
  actor: Actor,
  input: OpenReminderInput,
): Promise<ReminderResult<OpenedReminder>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("record_reminder_opened", {
    p_payment_id: input.paymentId,
    p_kind: input.kind,
    // Absent: the client's language from the card.
    p_locale: input.locale,
  });
  if (error) return { ok: false, error: reminderError(error) };
  const row = z
    .object({
      id: z.string(),
      client_id: z.string(),
      opened_at: z.string(),
      status: statusShape,
      created: z.boolean(),
    })
    .parse(data);
  return {
    ok: true,
    data: {
      id: row.id,
      clientId: row.client_id,
      openedAt: row.opened_at,
      status: row.status,
      created: row.created,
    },
  };
}

/** The manual "marked as sent" for an opened chat. A second mark changes nothing. */
export async function markReminderSent(
  db: Db,
  actor: Actor,
  input: MarkReminderSentInput,
): Promise<ReminderResult<MarkedReminder>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("mark_reminder_sent", {
    p_event_id: input.eventId,
  });
  if (error) return { ok: false, error: reminderError(error) };
  const row = z
    .object({
      id: z.string(),
      status: statusShape,
      marked_sent_at: z.string().nullable(),
      changed: z.boolean(),
    })
    .parse(data);
  return {
    ok: true,
    data: {
      id: row.id,
      status: row.status,
      markedSentAt: row.marked_sent_at,
      changed: row.changed,
    },
  };
}

/** Saves the days and the texts in one transaction, with an audit row per change. Owner only. */
export async function saveReminderSettings(
  db: Db,
  actor: Actor,
  input: ReminderSettingsInput,
): Promise<SettingsResult> {
  if (actor.role !== "owner") return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("update_reminder_settings", {
    p_reminder_days: reminderDaysOf(input),
    p_templates: input.templates,
  });
  if (error) return { ok: false, error: reminderError(error) };
  const row = z
    .object({ days_changed: z.boolean(), templates_changed: z.number() })
    .parse(data);
  return {
    ok: true,
    daysChanged: row.days_changed,
    templatesChanged: row.templates_changed,
  };
}
