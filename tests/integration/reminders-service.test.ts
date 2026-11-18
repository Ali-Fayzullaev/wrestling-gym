import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { afterAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { authorizeStaff } from "@/features/auth/service";
import type { Actor } from "@/features/auth/roles";
import {
  getReminderHistory,
  getRemindersOverdue,
  getRemindersToday,
  getReminderSettings,
  markReminderSent,
  openReminder,
  saveReminderSettings,
} from "@/features/reminders/service";
import { getTodayScreen } from "@/features/today/service";

import { SEED_EMAILS, SEED_PASSWORD } from "../support/staff-accounts";
import { connectLocalDb } from "./db";
import { insertClient, insertPayment } from "./support/fixtures";
import { SEED_STAFF } from "./support/roles";

const sql = connectLocalDb();

/**
 * Committed fixtures stay in the database, so their phones must not collide with the per-file
 * testPhone() counter other suites use for rolled-back fixtures (phone duplicate checks).
 */
function committedPhone(): string {
  return `+7701${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

afterAll(async () => {
  await sql.end();
});

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
};

const OWNER: Actor = { id: SEED_STAFF.owner, role: "owner" };
const ADMIN: Actor = { id: SEED_STAFF.admin, role: "admin" };

/** A signed-in client that counts its requests to the database API (PostgREST). */
async function signedIn(email: string) {
  const counter = { rest: 0 };
  const db: Db = createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("/rest/v1/")) counter.rest += 1;
          return fetch(input, init);
        },
      },
    },
  );
  const { error } = await db.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return { db, counter };
}

/**
 * A committed, archived client with a payment ending tomorrow. Events are append-only and stay;
 * the archive keeps the client off every list.
 */
async function archivedSubscription(): Promise<string> {
  return sql.begin(async (tx) => {
    const clientId = await insertClient(tx, {
      lastName: "Сервисный",
      archived: true,
      phone: committedPhone(),
    });
    return insertPayment(tx, {
      clientId,
      periodStart: "2026-10-17",
      periodEnd: "2026-11-15",
    });
  });
}

function decodedText(href: string): string {
  return new URL(href).searchParams.get("text") ?? "";
}

describe("screens: at most two database requests, links built on the server", () => {
  it("Reminders, today tab: role check + reminders_screen; every link is a filled wa.me", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const today = await getRemindersToday(db, new Date());
    expect(counter.rest).toBeLessThanOrEqual(2);
    expect(today.due.length).toBeGreaterThan(0);
    // A client on their own carries a link; a parent's children share the family message.
    for (const target of today.due.flatMap((block) =>
      block.family ? [] : block.items,
    )) {
      expect(target.href).toMatch(/^https:\/\/wa\.me\/77\d{9}\?text=/);
      const text = decodedText(target.href ?? "");
      expect(text).not.toMatch(
        /\{(имя|дата_окончания|сумма|группа|название_зала)\}/,
      );
      expect(text).toContain("Здравствуйте");
    }
  });

  it("Today: the remind rows carry the same kind of link and the counter matches", async () => {
    const { db } = await signedIn(SEED_EMAILS.owner);
    const screen = await getTodayScreen(db, new Date());
    // One message per client or per parent (D-18); the counter counts clients.
    expect(screen.remind.flatMap((group) => group.rows)).toHaveLength(
      screen.counts.remindToday,
    );
    for (const group of screen.remind) {
      // Step 20 (D-17): a ready link in every language, the card's language picked first.
      const { message } = group;
      expect(message?.defaultLocale).toMatch(/^(ru|kk|uz)$/);
      for (const variant of Object.values(message?.variants ?? {})) {
        expect(variant.href).toMatch(/^https:\/\/wa\.me\/77\d{9}\?text=/);
        expect(decodedText(variant.href)).toBe(variant.text);
      }
      expect(message?.variants.ru.text).toContain("Здравствуйте");
      expect(message?.variants.kk.text).toContain("Сәлеметсіз бе");
      expect(message?.variants.uz.text).toContain("Ассалому алайкум");
      if ("parentId" in group.target) {
        // The seed has families: several children in one message, one line each.
        expect(group.target.items).toHaveLength(group.rows.length);
        for (const name of group.firstNames)
          expect(message?.variants.ru.text).toContain(`${name}: до `);
      } else {
        expect(group.target.paymentId).toMatch(/^[0-9a-f-]{36}$/);
      }
    }
  });

  it("overdue and history tabs and the settings screen parse and stay within two requests", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.owner);
    const now = new Date();
    await authorizeStaff(db, ["owner"]);
    await getRemindersOverdue(db, now);
    expect(counter.rest).toBe(2);
    await getReminderHistory(db, now, {});
    expect(counter.rest).toBe(3);
    const settings = await getReminderSettings(db, now);
    expect(counter.rest).toBe(4);
    // Three kinds and the several-children text in three languages (D-13, D-18).
    expect(settings.context.templates).toHaveLength(12);
    expect(settings.preview?.name).toMatch(/^\S+ \S+/);
  });

  it("refuses a visitor without a session", async () => {
    const anon: Db = createSupabase<Database>(
      connection.apiUrl,
      connection.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await expect(getRemindersToday(anon, new Date())).rejects.toThrow(
      /reminders_screen failed/,
    );
    expect(
      await openReminder(anon, ADMIN, {
        paymentId: randomUUID(),
        kind: "before_1",
      }),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("chat opened and marked sent through the service", () => {
  it("two calls give one event; marking twice changes it once", async () => {
    const paymentId = await archivedSubscription();
    const { db } = await signedIn(SEED_EMAILS.admin);
    const input = { paymentId, kind: "before_1" as const };
    const [first, second] = await Promise.all([
      openReminder(db, ADMIN, input),
      openReminder(db, ADMIN, input),
    ]);
    if (!first?.ok || !second?.ok) throw new Error("open failed");
    expect(second.data.id).toBe(first.data.id);
    expect([first.data.created, second.data.created].sort()).toEqual([
      false,
      true,
    ]);

    const marked = await markReminderSent(db, ADMIN, {
      eventId: first.data.id,
    });
    const again = await markReminderSent(db, ADMIN, {
      eventId: first.data.id,
    });
    expect(marked).toMatchObject({
      ok: true,
      data: { status: "marked_sent", changed: true },
    });
    expect(again).toMatchObject({
      ok: true,
      data: { status: "marked_sent", changed: false },
    });
  });

  it("step 20: the chosen language reaches the database, the card keeps its own", async () => {
    const paymentId = await archivedSubscription();
    const { db } = await signedIn(SEED_EMAILS.admin);
    // Committed: before_7, whose templates no test removes (the step 19 test deletes overdue/kk).
    const opened = await openReminder(db, ADMIN, {
      paymentId,
      kind: "before_7",
      locale: "kk",
    });
    if (!opened.ok) throw new Error("open failed");
    const [row] = await sql<
      { template_locale: string; client_locale: string }[]
    >`
      select t.locale as template_locale, c.message_locale as client_locale
      from public.reminder_events e
      join public.message_templates t on t.id = e.template_id
      join public.clients c on c.id = e.client_id
      where e.id = ${opened.data.id}
    `;
    expect(row).toEqual({ template_locale: "kk", client_locale: "ru" });
  });

  it("reports an unknown payment or event as not_found", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    expect(
      await openReminder(db, ADMIN, {
        paymentId: randomUUID(),
        kind: "overdue",
      }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await markReminderSent(db, ADMIN, { eventId: randomUUID() }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("criterion 5 through the service: admin cannot save reminder settings", () => {
  const input = { firstDays: 5, secondDays: 2, templates: [] };

  it("an admin actor is refused before the database", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    expect(await saveReminderSettings(db, ADMIN, input)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(counter.rest).toBe(0);
  });

  it("an admin session claiming to be the owner is refused by the database", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    expect(await saveReminderSettings(db, OWNER, input)).toEqual({
      ok: false,
      error: "forbidden",
    });
    const [row] = await sql<{ reminder_days: number[] }[]>`
      select reminder_days from public.settings
    `;
    expect(row?.reminder_days).toEqual([7, 1]);
  });
});
