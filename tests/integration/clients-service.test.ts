import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { afterAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { authorizeStaff } from "@/features/auth/service";
import { clientInputSchema } from "@/features/clients/schema";
import {
  CLIENTS_LIST_LIMIT,
  createClient,
  deleteClient,
  findPhoneDuplicates,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
} from "@/features/clients/service";

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
/** The first seed client (supabase/seed.sql). */
const SEED_CLIENT = "20000000-0000-4000-8000-000000000001";

const createdClients: string[] = [];
let phoneNo = 9700;

afterAll(async () => {
  // Clients without consents or payments only; deleted ones are already gone.
  if (createdClients.length)
    await service.from("clients").delete().in("id", createdClients);
});

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

function input(overrides: Record<string, unknown> = {}) {
  phoneNo += 1;
  return clientInputSchema.parse({
    lastName: "Сервисов",
    firstName: "Тест",
    birthDate: "",
    phone: `8 700 000 ${String(phoneNo).slice(0, 2)} ${String(phoneNo).slice(2)}`,
    kind: "adult",
    groupId: SEED_GROUP,
    startedOn: "2026-11-01",
    note: "",
    messageLocale: "ru",
    consents: [],
    ...overrides,
  });
}

async function newClient(db: Db): Promise<string> {
  const result = await createClient(db, ADMIN, input());
  if (!result.ok) throw new Error(`createClient failed: ${result.error}`);
  createdClients.push(result.data.id);
  return result.data.id;
}

describe("criterion 10: the list costs one data request, the card stays within three", () => {
  it("list: role check + clients_screen", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await listClients(db, NOW);
    expect(screen.clients.length).toBeGreaterThanOrEqual(150);
    expect(screen.groups.length).toBeGreaterThan(0);
    expect(screen.coaches.length).toBeGreaterThan(0);
    expect(counter.rest).toBe(2);
  });

  it("card: role check + client_screen", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await getClient(db, NOW, SEED_CLIENT);
    expect(screen?.client.id).toBe(SEED_CLIENT);
    expect(screen?.groups.length).toBeGreaterThan(0);
    expect(counter.rest).toBeLessThanOrEqual(3);
  });

  it("an unknown client is null, not an error", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    await expect(getClient(db, NOW, randomUUID())).resolves.toBeNull();
  });
});

describe("the list threshold", () => {
  it("is 500 clients; past it the list is cut and the total says so", async () => {
    expect(CLIENTS_LIST_LIMIT).toBe(500);
    const { db } = await signedIn(SEED_EMAILS.admin);
    const cut = await listClients(db, NOW, 20);
    expect(cut.clients).toHaveLength(20);
    expect(cut.total).toBeGreaterThan(20);
  });
});

describe("criterion 5 (service): admins cannot delete", () => {
  it("deleteClient refuses an admin without a request", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await expect(
      deleteClient(db, ADMIN, {
        clientId: SEED_CLIENT,
        reason: "duplicate",
        lastName: "x",
      }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(counter.rest).toBe(0);
  });

  it("an admin pretending to be the owner is refused by the database", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    const result = await deleteClient(db, OWNER, {
      clientId: SEED_CLIENT,
      reason: "duplicate",
      lastName: "x",
    });
    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("owner: wrong last name is reported, the right one deletes", async () => {
    const admin = await signedIn(SEED_EMAILS.admin);
    const id = await newClient(admin.db);
    const { db } = await signedIn(SEED_EMAILS.owner);
    await expect(
      deleteClient(db, OWNER, {
        clientId: id,
        reason: "duplicate",
        lastName: "Другой",
      }),
    ).resolves.toEqual({ ok: false, error: "confirmation_mismatch" });
    await expect(
      deleteClient(db, OWNER, {
        clientId: id,
        reason: "duplicate",
        lastName: "сервисов",
      }),
    ).resolves.toEqual({
      ok: true,
      data: { mode: "deleted", reason: "duplicate" },
    });
    await expect(getClient(db, NOW, id)).resolves.toBeNull();
    const { data } = await service
      .from("audit_log")
      .select("actor_id, details")
      .eq("action", "client.delete")
      .eq("entity_id", id);
    expect(data).toEqual([
      {
        actor_id: SEED_STAFF.owner,
        details: { mode: "deleted", reason: "duplicate" },
      },
    ]);
  });
});

describe("repeated and parallel requests", () => {
  it("two parallel archive requests: one change, one audit row", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    const id = await newClient(db);
    const other = await signedIn(SEED_EMAILS.otherAdmin);
    const results = await Promise.all([
      setClientArchived(db, ADMIN, { clientId: id, archived: true }),
      setClientArchived(other.db, ADMIN, { clientId: id, archived: true }),
    ]);
    expect(results.map((r) => r.ok && r.data.changed).sort()).toEqual([
      false,
      true,
    ]);
    const { data } = await service
      .from("audit_log")
      .select("id")
      .eq("action", "client.archive")
      .eq("entity_id", id);
    expect(data).toHaveLength(1);
  });

  it("two parallel deletions: one succeeds, the other finds nothing", async () => {
    const admin = await signedIn(SEED_EMAILS.admin);
    const id = await newClient(admin.db);
    const first = await signedIn(SEED_EMAILS.owner);
    const second = await signedIn(SEED_EMAILS.owner);
    const request = {
      clientId: id,
      reason: "duplicate" as const,
      lastName: "Сервисов",
    };
    const results = await Promise.all([
      deleteClient(first.db, OWNER, request),
      deleteClient(second.db, OWNER, request),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "not_found" },
    ]);
  });

  it("an update of a deleted client is refused", async () => {
    const admin = await signedIn(SEED_EMAILS.admin);
    const id = await newClient(admin.db);
    const owner = await signedIn(SEED_EMAILS.owner);
    await deleteClient(owner.db, OWNER, {
      clientId: id,
      reason: "created_by_mistake",
      lastName: "Сервисов",
    });
    await expect(updateClient(admin.db, ADMIN, id, input())).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("duplicates and groups", () => {
  it("findPhoneDuplicates lists the other client with the same phone", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    const id = await newClient(db);
    const phone = defined((await getClient(db, NOW, id))?.client.phone);
    const second = await createClient(db, ADMIN, { ...input(), phone });
    if (!second.ok) throw new Error(second.error);
    createdClients.push(second.data.id);
    const result = await findPhoneDuplicates(db, ADMIN, phone, id);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: second.data.id,
          lastName: "Сервисов",
          firstName: "Тест",
          archived: false,
        },
      ],
    });
  });

  it("an archived group is reported as group_not_found", async () => {
    const { data: group } = await service
      .from("groups")
      .insert({
        name: `Архив ${randomUUID().slice(0, 8)}`,
        coach_id: SEED_STAFF.admin,
        default_price: 100,
        archived_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const groupId = defined(group).id;
    const { db } = await signedIn(SEED_EMAILS.admin);
    await expect(createClient(db, ADMIN, input({ groupId }))).resolves.toEqual({
      ok: false,
      error: "group_not_found",
    });
    await service.from("groups").delete().eq("id", groupId);
  });
});
