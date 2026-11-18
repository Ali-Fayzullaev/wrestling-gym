import { z } from "zod";

import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";
import { businessDate } from "@/lib/dates";
import { LOCALES, type Locale } from "@/lib/locale";
import { buildWaLink } from "@/lib/whatsapp";

import { groupDueRows } from "./group";
import {
  REMINDER_KINDS,
  type ReminderKind,
  type ReminderStatus,
  TEMPLATE_KINDS,
} from "./kinds";
import {
  type FamilyReminderTarget,
  isFamilyTarget,
  type MarkedFamily,
  type MarkedReminder,
  type OpenedReminder,
  type OpenReminderInput,
  type ReminderError,
  type ReminderResult,
  type SettingsResult,
} from "./result";
import {
  type HistoryFilter,
  type MarkFamilySentInput,
  type MarkReminderSentInput,
  reminderDaysOf,
  type ReminderSettingsInput,
} from "./schema";
import {
  familyValues,
  type FamilyChild,
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
      kind: z.enum(TEMPLATE_KINDS),
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
  // Whoever gets the message: the parent for a child (D-18), in their language.
  phone: z.string(),
  parent_id: z.string().nullable(),
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

// A chat opened today also names the child's parent (step 22), to put siblings together.
const openedEventShape = namedEventShape.extend({
  parent_id: z.string().nullable(),
  parent_name: z.string().nullable(),
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

export type NamedReminderEvent = ReminderEvent & {
  name: string;
  firstName: string;
};

/** A parent with several children in one message, and that message (D-18). */
export type ReminderFamily = {
  parent: { id: string; name: string };
  /** The children's first names, as the block's title lists them. */
  firstNames: string[];
  /** "Chat opened" for every child in it. */
  target: FamilyReminderTarget;
  /** The text and wa.me link in each language; null when the template is missing. */
  message: ReminderMessage | null;
};

/**
 * One message on a Reminders tab: a client on their own (one item, its own link), or a parent's
 * children (`family` set) with one message about all of them.
 */
export type ReminderBlock<T> = { family: ReminderFamily | null; items: T[] };

/**
 * Chats opened today: one event, or several children of one parent together (`parent` set), so
 * "Sent" can mark them at once.
 */
export type OpenedBlock = {
  parent: { id: string; name: string } | null;
  events: NamedReminderEvent[];
};

export type RemindersToday = {
  reminderDays: number[];
  /** Due today and not opened yet: the same messages as "Remind today" on the Today screen. */
  due: ReminderBlock<ReminderTarget>[];
  /** Chats opened today, newest first. */
  opened: OpenedBlock[];
};

export type OverdueTarget = ReminderTarget & { event: ReminderEvent | null };

export type RemindersOverdue = {
  overdue: ReminderBlock<OverdueTarget>[];
  /** Clients on the tab, to tell when the list hit the row limit. */
  rows: number;
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
  return messageInEveryLocale(contact.phone, contact.messageLocale, (locale) =>
    buildReminderText(contact, kind, context, today, locale),
  );
}

function messageInEveryLocale(
  phone: string,
  defaultLocale: Locale,
  textIn: (locale: Locale) => ReminderText | null,
): ReminderMessage | null {
  const variant = (locale: Locale): ReminderVariant | null => {
    const reminder = textIn(locale);
    return reminder && { ...reminder, href: buildWaLink(phone, reminder.text) };
  };
  const [ru, kk, uz] = [variant("ru"), variant("kk"), variant("uz")];
  if (!ru || !kk || !uz) return null;
  return { defaultLocale, variants: { ru, kk, uz } };
}

/** A parent with several children to remind on the same day (D-18). */
export type FamilyContact = {
  parentName: string;
  /** The parent's phone: the message goes there. */
  phone: string;
  /** The parent's language. */
  messageLocale: Locale;
  children: FamilyChild[];
};

/** The "several children" text in `locale` (or Russian), one line per child. */
export function buildFamilyText(
  family: FamilyContact,
  context: ReminderContext,
  today: Date,
  locale: Locale = family.messageLocale,
): ReminderText | null {
  const template = pickTemplate(context.templates, "family", locale);
  if (!template) return null;
  return {
    text: renderTemplate(
      template.body,
      familyValues(
        family.parentName,
        family.children,
        context.gymName,
        today,
        template.locale,
      ),
    ),
    locale: template.locale,
    draft: isDraftTemplate(template),
  };
}

/** One message to the parent about all of `family.children`, in ru, kk and uz (D-17, D-18). */
export function buildFamilyMessage(
  family: FamilyContact,
  context: ReminderContext,
  today: Date,
): ReminderMessage | null {
  return messageInEveryLocale(family.phone, family.messageLocale, (locale) =>
    buildFamilyText(family, context, today, locale),
  );
}

/** What one child adds to a family message, and how the children are told apart. */
export type FamilyMember = FamilyChild & {
  paymentId: string;
  kind: ReminderKind;
  /** Whoever gets the message: the parent's phone for a child. */
  phone: string;
  parentId: string | null;
  parentName: string | null;
  messageLocale: Locale;
};

/**
 * The family message for rows grouped by groupDueRows(): one message to the parent about all of
 * them. Null for a client on their own or a single child, who get the usual reminder.
 */
export function familyOf(
  rows: readonly FamilyMember[],
  context: ReminderContext,
  today: Date,
): ReminderFamily | null {
  const [first] = rows;
  if (!first || rows.length < 2) return null;
  if (first.parentId === null || first.parentName === null) return null;
  return {
    parent: { id: first.parentId, name: first.parentName },
    firstNames: rows.map((row) => row.firstName),
    target: {
      parentId: first.parentId,
      items: rows.map((row) => ({ paymentId: row.paymentId, kind: row.kind })),
    },
    message: buildFamilyMessage(
      {
        parentName: first.parentName,
        phone: first.phone,
        messageLocale: first.messageLocale,
        children: rows.map((row) => ({
          firstName: row.firstName,
          endsOn: row.endsOn,
          price: row.price,
        })),
      },
      context,
      today,
    ),
  };
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

function toMember(
  row: z.infer<typeof contactShape>,
  kind: ReminderKind,
): FamilyMember {
  return {
    paymentId: row.payment_id,
    kind,
    firstName: row.first_name,
    endsOn: row.ends_on,
    price: row.price,
    phone: row.phone,
    parentId: row.parent_id,
    parentName: row.parent_name,
    messageLocale: row.message_locale,
  };
}

/** Rows of one tab as messages: a parent's children together (D-18), in the tab's order. */
function toBlocks<R extends z.infer<typeof contactShape>, T>(
  rows: readonly R[],
  kindOf: (row: R) => ReminderKind,
  toItem: (row: R) => T,
  context: ReminderContext,
  today: Date,
): ReminderBlock<T>[] {
  return groupDueRows(
    rows.map((row) => ({ row, parentId: row.parent_id })),
  ).map((group) => ({
    family: familyOf(
      group.map(({ row }) => toMember(row, kindOf(row))),
      context,
      today,
    ),
    items: group.map(({ row }) => toItem(row)),
  }));
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
  return {
    ...toEvent(row),
    name: `${row.last_name} ${row.first_name}`,
    firstName: row.first_name,
  };
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

/** Opened events of several children of one parent go together, at the place of the newest. */
function toOpenedBlocks(
  rows: readonly z.infer<typeof openedEventShape>[],
): OpenedBlock[] {
  return groupDueRows(
    rows.map((row) => ({ row, parentId: row.parent_id })),
  ).map((group) => {
    const [first] = group;
    const parent =
      group.length > 1 && first?.row.parent_id && first.row.parent_name
        ? { id: first.row.parent_id, name: first.row.parent_name }
        : null;
    return { parent, events: group.map(({ row }) => toNamedEvent(row)) };
  });
}

/** The "today" tab of reminders_screen(), checked and turned into messages. */
export function parseRemindersToday(raw: unknown, now: Date): RemindersToday {
  const screen = z
    .object({
      context: z.unknown(),
      due: z.array(contactShape.extend({ kind: kindShape })),
      opened: z.array(openedEventShape),
    })
    .parse(raw);
  const context = parseReminderContext(screen.context);
  return {
    reminderDays: context.reminderDays,
    due: toBlocks(
      screen.due,
      (row) => row.kind,
      (row) => toTarget(row, row.kind, context, now),
      context,
      now,
    ),
    opened: toOpenedBlocks(screen.opened),
  };
}

/** "Today" tab: due reminders with links and the chats opened today. One database request. */
export async function getRemindersToday(
  db: Db,
  now: Date,
): Promise<RemindersToday> {
  return parseRemindersToday(await screenTab(db, now, "today"), now);
}

/** The "overdue" tab of reminders_screen(), checked and turned into messages. */
export function parseRemindersOverdue(
  raw: unknown,
  now: Date,
): RemindersOverdue {
  const screen = z
    .object({
      context: z.unknown(),
      overdue: z.array(contactShape.extend({ event: eventShape.nullable() })),
    })
    .parse(raw);
  const context = parseReminderContext(screen.context);
  return {
    overdue: toBlocks(
      screen.overdue,
      () => "overdue",
      (row) => ({
        ...toTarget(row, "overdue", context, now),
        event: row.event ? toEvent(row.event) : null,
      }),
      context,
      now,
    ),
    rows: screen.overdue.length,
  };
}

/** "Overdue" tab: ended subscriptions with their "overdue" reminder, a parent's children together. */
export async function getRemindersOverdue(
  db: Db,
  now: Date,
): Promise<RemindersOverdue> {
  return parseRemindersOverdue(await screenTab(db, now, "overdue"), now);
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
  parent_not_found: "not_found",
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

const openedShape = z.object({
  id: z.string(),
  client_id: z.string(),
  opened_at: z.string(),
  status: statusShape,
  created: z.boolean(),
});

function toOpened(row: z.infer<typeof openedShape>): OpenedReminder {
  return {
    id: row.id,
    clientId: row.client_id,
    openedAt: row.opened_at,
    status: row.status,
    created: row.created,
  };
}

/**
 * Records "chat opened" for this subscription and reminder kind, or, for one message to a parent,
 * for every child in it (in one transaction). Repeating it (a second click, a network retry,
 * another tab) returns the first events: the database key allows only one per subscription and
 * kind. A family message answers with its first child's event.
 */
export async function openReminder(
  db: Db,
  actor: Actor,
  input: OpenReminderInput,
): Promise<ReminderResult<OpenedReminder>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  if (isFamilyTarget(input)) {
    const { data, error } = await db.rpc("record_family_reminder_opened", {
      p_parent_id: input.parentId,
      p_items: input.items.map((item) => ({
        payment_id: item.paymentId,
        kind: item.kind,
      })),
      // Absent: the parent's language from the card.
      p_locale: input.locale,
    });
    if (error) return { ok: false, error: reminderError(error) };
    const [first] = z.array(openedShape).min(1).parse(data);
    return first
      ? { ok: true, data: toOpened(first) }
      : { ok: false, error: "unavailable" };
  }
  const { data, error } = await db.rpc("record_reminder_opened", {
    p_payment_id: input.paymentId,
    p_kind: input.kind,
    // Absent: the language on the card (the parent's for a child).
    p_locale: input.locale,
  });
  if (error) return { ok: false, error: reminderError(error) };
  return { ok: true, data: toOpened(openedShape.parse(data)) };
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

const markedFamilyShape = z
  .array(
    z.object({
      id: z.string(),
      client_id: z.string(),
      status: statusShape,
      marked_sent_at: z.string().nullable(),
      changed: z.boolean(),
    }),
  )
  .min(1);

/**
 * "Marked as sent" for one message to a parent: every child in it at once, in one transaction.
 * A child whose chat was never opened refuses the whole call; children already marked stay as
 * they were, so a repeat changes nothing.
 */
export async function markFamilyRemindersSent(
  db: Db,
  actor: Actor,
  input: MarkFamilySentInput,
): Promise<ReminderResult<MarkedFamily>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("mark_family_reminders_sent", {
    p_parent_id: input.parentId,
    p_items: input.items.map((item) => ({
      payment_id: item.paymentId,
      kind: item.kind,
    })),
  });
  if (error) return { ok: false, error: reminderError(error) };
  const rows = markedFamilyShape.parse(data);
  return {
    ok: true,
    data: { changed: rows.filter((row) => row.changed).length },
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
