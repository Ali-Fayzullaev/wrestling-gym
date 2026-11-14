import { z } from "zod";

import type { Db } from "@/db/client";
import { businessDate } from "@/lib/dates";

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

const screenShape = z.object({
  counts: z.object({
    remind_today: z.number(),
    debtors: z.number(),
    expiring_week: z.number(),
    paid_today: z.number(),
  }),
  remind: z.array(rowShape),
  paid: z.array(rowShape),
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

export type TodayScreen = {
  counts: TodayCounts;
  /** Reminders due today and not opened yet, soonest end first. */
  remind: TodayRow[];
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

/** Everything the Today screen shows, in one database request. */
export async function getTodayScreen(db: Db, now: Date): Promise<TodayScreen> {
  const { data, error } = await db.rpc("today_screen", {
    p_today: businessDate(now),
  });
  if (error) throw new Error(`today_screen failed: ${error.code}`);
  const screen = screenShape.parse(data);
  return {
    counts: {
      remindToday: screen.counts.remind_today,
      debtors: screen.counts.debtors,
      expiringWeek: screen.counts.expiring_week,
      paidToday: screen.counts.paid_today,
    },
    remind: screen.remind.map(toRow),
    paid: screen.paid.map(toRow),
  };
}
