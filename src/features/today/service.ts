import { z } from "zod";

import type { Db } from "@/db/client";
import { REMINDER_KINDS, type ReminderKind } from "@/features/reminders/kinds";
import type { ReminderTargetInput } from "@/features/reminders/result";
import {
  buildFamilyMessage,
  buildReminderMessage,
  parseReminderContext,
  type ReminderContext,
  type ReminderMessage,
} from "@/features/reminders/service";
import { businessDate } from "@/lib/dates";
import { LOCALES } from "@/lib/locale";

// Shape of today_screen() (supabase/migrations/*_today_screen.sql). The database returns jsonb, so
// the reply is checked rather than trusted. Counters come from dashboard_counts() inside it and are
// never recomputed here.
const rowShape = z.object({
  id: z.string(),
  last_name: z.string(),
  first_name: z.string(),
  group_name: z.string().nullable(),
  price: z.number().nullable(),
  ends_on: z.string().nullable(),
});

// What a "remind" row's wa.me link is built from: whoever gets the message (the parent for a
// child, D-18) and, for a child, the parent's id, so one parent's children share one message.
const reminderShape = z.object({
  payment_id: z.string(),
  kind: z.enum(REMINDER_KINDS),
  phone: z.string(),
  parent_id: z.string().nullable(),
  parent_name: z.string().nullable(),
  message_locale: z.enum(LOCALES),
});

const screenShape = z.object({
  counts: z.object({
    remind_today: z.number(),
    debtors: z.number(),
    expiring_week: z.number(),
    paid_today: z.number(),
  }),
  remind: z.array(rowShape.extend({ reminder: reminderShape })),
  paid: z.array(rowShape),
  reminder_context: z.unknown(),
});

export type TodayCounts = {
  remindToday: number;
  debtors: number;
  expiringWeek: number;
  paidToday: number;
};

export type TodayRow = {
  id: string;
  name: string;
  /** The client's active group; null without one. */
  groupName: string | null;
  /** The active group's monthly price, offered in the payment form. */
  price: number | null;
  /** YYYY-MM-DD, end of the current subscription. */
  endsOn: string | null;
};

/**
 * One message to send today: one client, or one parent with every child of theirs due today
 * (D-18). The WhatsApp button opens `message` and records "chat opened" for `target`.
 */
export type TodayRemindGroup = {
  /** The parent of the children in it; null for a client reminded on their own phone. */
  parent: { id: string; name: string } | null;
  /** First names of the clients in the message, as the family line on the screen lists them. */
  firstNames: string[];
  /** The clients the message is about, soonest end first. */
  rows: TodayRow[];
  target: ReminderTargetInput;
  /** The text and wa.me link in each language; null when the template is missing. */
  message: ReminderMessage | null;
};

/** A "remind" row as today_screen() returns it, flattened. */
export type DueRow = TodayRow & {
  paymentId: string;
  kind: ReminderKind;
  firstName: string;
  phone: string;
  parentId: string | null;
  parentName: string | null;
  messageLocale: z.infer<typeof reminderShape>["message_locale"];
};

/**
 * Puts the children of one parent into one group, in the order of the first of them (the rows
 * come soonest end first); everybody else is a group of one.
 */
export function groupDueRows(rows: readonly DueRow[]): DueRow[][] {
  const groups: DueRow[][] = [];
  const byParent = new Map<string, DueRow[]>();
  for (const row of rows) {
    if (row.parentId === null) {
      groups.push([row]);
      continue;
    }
    const group = byParent.get(row.parentId);
    if (group) {
      group.push(row);
      continue;
    }
    const created = [row];
    byParent.set(row.parentId, created);
    groups.push(created);
  }
  return groups;
}

function toRemindGroup(
  rows: readonly DueRow[],
  context: ReminderContext,
  now: Date,
): TodayRemindGroup | null {
  const [first] = rows;
  if (!first) return null;
  const parent =
    first.parentId !== null && first.parentName !== null
      ? { id: first.parentId, name: first.parentName }
      : null;
  if (parent && rows.length > 1) {
    return {
      parent,
      firstNames: rows.map((row) => row.firstName),
      rows: rows.map(toPlainRow),
      target: {
        parentId: parent.id,
        items: rows.map((row) => ({
          paymentId: row.paymentId,
          kind: row.kind,
        })),
      },
      message: buildFamilyMessage(
        {
          parentName: parent.name,
          phone: first.phone,
          messageLocale: first.messageLocale,
          children: rows.map((row) => ({
            firstName: row.firstName,
            endsOn: row.endsOn,
            price: row.price,
          })),
        },
        context,
        now,
      ),
    };
  }
  return {
    parent,
    firstNames: [first.firstName],
    rows: [toPlainRow(first)],
    target: { paymentId: first.paymentId, kind: first.kind },
    message: buildReminderMessage(
      {
        firstName: first.firstName,
        parentName: first.parentName,
        messageLocale: first.messageLocale,
        groupName: first.groupName,
        price: first.price,
        endsOn: first.endsOn,
        phone: first.phone,
      },
      first.kind,
      context,
      now,
    ),
  };
}

function toPlainRow(row: DueRow): TodayRow {
  return {
    id: row.id,
    name: row.name,
    groupName: row.groupName,
    price: row.price,
    endsOn: row.endsOn,
  };
}

export type TodayScreen = {
  counts: TodayCounts;
  /** Messages to send today (one per client, or per parent), soonest end first. */
  remind: TodayRemindGroup[];
  /** Clients with a payment recorded today (not reversed), by name. */
  paid: TodayRow[];
};

function toRow(row: z.infer<typeof rowShape>): TodayRow {
  return {
    id: row.id,
    name: `${row.last_name} ${row.first_name}`,
    groupName: row.group_name,
    price: row.price,
    endsOn: row.ends_on,
  };
}

function toDueRow(row: z.infer<typeof screenShape>["remind"][number]): DueRow {
  const { reminder } = row;
  return {
    ...toRow(row),
    firstName: row.first_name,
    paymentId: reminder.payment_id,
    kind: reminder.kind,
    phone: reminder.phone,
    parentId: reminder.parent_id,
    parentName: reminder.parent_name,
    messageLocale: reminder.message_locale,
  };
}

/** Everything the Today screen shows, in one database request. */
export async function getTodayScreen(db: Db, now: Date): Promise<TodayScreen> {
  const { data, error } = await db.rpc("today_screen", {
    p_today: businessDate(now),
  });
  if (error) throw new Error(`today_screen failed: ${error.code}`);
  const screen = screenShape.parse(data);
  const context = parseReminderContext(screen.reminder_context);
  return {
    counts: {
      remindToday: screen.counts.remind_today,
      debtors: screen.counts.debtors,
      expiringWeek: screen.counts.expiring_week,
      paidToday: screen.counts.paid_today,
    },
    remind: groupDueRows(screen.remind.map(toDueRow))
      .map((rows) => toRemindGroup(rows, context, now))
      .filter((group): group is TodayRemindGroup => group !== null),
    paid: screen.paid.map(toRow),
  };
}
