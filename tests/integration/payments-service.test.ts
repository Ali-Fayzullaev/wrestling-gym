import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { authorizeStaff } from "@/features/auth/service";
import { getClient } from "@/features/clients/service";
import { nextPeriod, periodEnd } from "@/features/payments/period";
import {
  cancelRecentPayment,
  recordPayment,
  reversePayment,
} from "@/features/payments/service";

import { businessDate } from "@/lib/dates";

import { defined } from "../support/defined";
import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { SEED_GROUP, SEED_STAFF } from "./support/roles";

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const NOW = new Date("2026-11-14T09:00:00Z");
const OWNER = { id: SEED_STAFF.owner, role: "owner" } as const;
const ADMIN = { id: SEED_STAFF.admin, role: "admin" } as const;

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

let phoneNo = 9800;

/**
 * A committed client for payments made over the API. Payments are append-only, so it stays in the
 * local database; it is archived to keep it out of the lists and counters.
 */
async function archivedClient(): Promise<string> {
  phoneNo += 1;
  const { data, error } = await service
    .from("clients")
    .insert({
      last_name: "Оплатов",
      first_name: "Тест",
      phone: `+7700000${String(phoneNo).padStart(4, "0")}`,
      phone_owner: "self",
      group_id: SEED_GROUP,
      started_on: "2026-11-01",
      archived_at: new Date().toISOString(),
      created_by: SEED_STAFF.owner,
    })
    .select("id")
    .single();
  if (error) throw new Error(`client insert failed: ${error.code}`);
  return data.id;
}

let admin: Awaited<ReturnType<typeof signedIn>>;
let owner: Awaited<ReturnType<typeof signedIn>>;

beforeAll(async () => {
  [admin, owner] = await Promise.all([
    signedIn(SEED_EMAILS.admin),
    signedIn(SEED_EMAILS.owner),
  ]);
});

describe("recordPayment over the API", () => {
  it("criterion 2: the same key twice gives one payment, both answers successful", async () => {
    const clientId = await archivedClient();
    const input = {
      clientId,
      amount: 15000,
      method: "kaspi" as const,
      idempotencyKey: randomUUID(),
    };
    const [first, second] = [
      await recordPayment(admin.db, ADMIN, input),
      await recordPayment(admin.db, ADMIN, input),
    ];
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.created).toBe(false);
    const { count } = await service
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    expect(count).toBe(1);
  });

  it("criterion 3: ten parallel requests with one key leave one payment", async () => {
    const clientId = await archivedClient();
    const input = {
      clientId,
      amount: 15000,
      method: "cash" as const,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => recordPayment(admin.db, ADMIN, input)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const ids = new Set(
      results.map((result) => (result.ok ? result.data.id : "")),
    );
    expect(ids.size).toBe(1);
    const { count } = await service
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    expect(count).toBe(1);
  });

  it("maps database refusals to codes the screen can show", async () => {
    const unknown = await recordPayment(admin.db, ADMIN, {
      clientId: randomUUID(),
      amount: 15000,
      method: "cash",
      idempotencyKey: randomUUID(),
    });
    expect(unknown).toEqual({ ok: false, error: "client_not_found" });

    const clientId = await archivedClient();
    const key = randomUUID();
    await recordPayment(admin.db, ADMIN, {
      clientId,
      amount: 15000,
      method: "cash",
      idempotencyKey: key,
    });
    const reused = await recordPayment(admin.db, ADMIN, {
      clientId,
      amount: 9000,
      method: "cash",
      idempotencyKey: key,
    });
    expect(reused).toEqual({ ok: false, error: "idempotency_conflict" });

    const zero = await recordPayment(admin.db, ADMIN, {
      clientId,
      amount: 0,
      method: "cash",
      idempotencyKey: randomUUID(),
    });
    expect(zero).toEqual({ ok: false, error: "invalid" });
  });

  it("step 18: an admin's chosen last day is stored; one out of bounds is refused, nothing stored", async () => {
    const clientId = await archivedClient();
    const today = businessDate(new Date());
    const rule = nextPeriod(null, today);
    const chosen = periodEnd(rule.start, 2);
    const saved = await recordPayment(admin.db, ADMIN, {
      clientId,
      amount: 15000,
      method: "cash",
      idempotencyKey: randomUUID(),
      periodEnd: chosen,
    });
    expect(saved.ok && saved.data.periodEnd).toBe(chosen);

    const other = await archivedClient();
    const tooEarly = await recordPayment(admin.db, ADMIN, {
      clientId: other,
      amount: 15000,
      method: "cash",
      idempotencyKey: randomUUID(),
      periodEnd: "2020-01-01",
    });
    expect(tooEarly).toEqual({ ok: false, error: "period_end_out_of_range" });
    const { count } = await service
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("client_id", other);
    expect(count).toBe(0);
  });
});

describe("cancel and reversal over the API", () => {
  it("the author cancels within 10 minutes; a second cancel says it is already cancelled", async () => {
    const clientId = await archivedClient();
    const paid = await recordPayment(admin.db, ADMIN, {
      clientId,
      amount: 15000,
      method: "cash",
      idempotencyKey: randomUUID(),
    });
    if (!paid.ok) throw new Error(paid.error);
    const cancelled = await cancelRecentPayment(admin.db, ADMIN, {
      paymentId: paid.data.id,
      idempotencyKey: randomUUID(),
    });
    expect(cancelled).toMatchObject({
      ok: true,
      data: { kind: "reversal", amount: -15000 },
    });
    const again = await cancelRecentPayment(admin.db, ADMIN, {
      paymentId: paid.data.id,
      idempotencyKey: randomUUID(),
    });
    expect(again).toEqual({ ok: false, error: "already_reversed" });
  });

  it("an admin gets no reversal: refused before any request", async () => {
    const before = admin.counter.rest;
    const result = await reversePayment(admin.db, ADMIN, {
      paymentId: randomUUID(),
      reason: "Ошибка",
      idempotencyKey: randomUUID(),
    });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(admin.counter.rest).toBe(before);
  });

  it("an admin calling reverse_payment directly is refused by the database", async () => {
    const { error } = await admin.db.rpc("reverse_payment", {
      p_payment_id: randomUUID(),
      p_reason: "Ошибка",
      p_idempotency_key: randomUUID(),
    });
    expect(error?.code).toBe("42501");
  });

  it("the owner reverses with a reason; the card shows it with the payment", async () => {
    const clientId = await archivedClient();
    const paid = await recordPayment(admin.db, ADMIN, {
      clientId,
      amount: 15000,
      method: "transfer",
      idempotencyKey: randomUUID(),
    });
    if (!paid.ok) throw new Error(paid.error);
    const reversed = await reversePayment(owner.db, OWNER, {
      paymentId: paid.data.id,
      reason: "Отмечено не тому клиенту",
      idempotencyKey: randomUUID(),
    });
    expect(reversed.ok).toBe(true);

    const before = admin.counter.rest;
    const screen = defined(await getClient(admin.db, NOW, clientId));
    expect(admin.counter.rest - before).toBe(1);
    expect(screen.payments).toHaveLength(2);
    const reversal = screen.payments.find((p) => p.kind === "reversal");
    expect(reversal).toMatchObject({
      reversesId: paid.data.id,
      reason: "Отмечено не тому клиенту",
      amount: -15000,
    });
    expect(screen.subscription.status).toBe("none");
  });
});

describe("the card stays within three requests with the payment history", () => {
  it("role check + client_screen", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await getClient(
      db,
      NOW,
      "20000000-0000-4000-8000-000000000001",
    );
    expect(screen?.payments.length).toBeGreaterThan(0);
    expect(screen?.group?.price).toBeGreaterThan(0);
    expect(counter.rest).toBeLessThanOrEqual(3);
  });
});
