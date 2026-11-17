import { z } from "zod";

import type { Db } from "@/db/client";
import { REMINDER_KINDS, type ReminderKind } from "@/features/reminders/kinds";
import {
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

// What a "remind" row's wa.me link is built from.
const reminderShape = z.object({
  payment_id: z.string(),
  kind: z.enum(REMINDER_KINDS),
  phone: z.string(),
  phone_owner: z.enum(["self", "parent"]),
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

/** The reminder due for a "remind" row: what the WhatsApp button opens and records. */
export type TodayReminder = {
  paymentId: string;
  kind: ReminderKind;
  /** The text and wa.me link in each language; null when the template of this kind is missing. */
  message: ReminderMessage | null;
};

export type TodayRemindRow = TodayRow & { reminder: TodayReminder };

export type TodayScreen = {
  counts: TodayCounts;
  /** Reminders due today and not opened yet, soonest end first. */
  remind: TodayRemindRow[];
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

function toRemindRow(
  row: z.infer<typeof screenShape>["remind"][number],
  context: ReminderContext,
  now: Date,
): TodayRemindRow {
  const { reminder } = row;
  const contact = {
    firstName: row.first_name,
    phoneOwner: reminder.phone_owner,
    parentName: reminder.parent_name,
    messageLocale: reminder.message_locale,
    groupName: row.group_name,
    price: row.price,
    endsOn: row.ends_on,
    phone: reminder.phone,
  };
  return {
    ...toRow(row),
    reminder: {
      paymentId: reminder.payment_id,
      kind: reminder.kind,
      message: buildReminderMessage(contact, reminder.kind, context, now),
    },
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
    remind: screen.remind.map((row) => toRemindRow(row, context, now)),
    paid: screen.paid.map(toRow),
  };
}
