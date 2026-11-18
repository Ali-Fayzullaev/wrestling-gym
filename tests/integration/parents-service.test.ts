import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { authorizeStaff } from "@/features/auth/service";
import { getClient } from "@/features/clients/service";
import {
  getParent,
  getParentOption,
  searchParents,
  updateParent,
} from "@/features/parents/service";

import { defined } from "../support/defined";
import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { SEED_STAFF } from "./support/roles";

// Step 21: the parent's card and picker through the services, as the screens call them.

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const NOW = new Date();
const ADMIN = { id: SEED_STAFF.admin, role: "admin" } as const;

/** A seed parent with at least two children, and one of the children. */
let family: { parentId: string; childId: string; name: string; phone: string };

beforeAll(async () => {
  const { data, error } = await service
    .from("parents")
    .select("id, name, phone, clients(id)")
    .is("archived_at", null);
  if (error) throw new Error(`parents failed: ${error.code}`);
  const parent = defined(data.find((row) => row.clients.length >= 2));
  family = {
    parentId: parent.id,
    childId: defined(parent.clients[0]).id,
    name: parent.name,
    phone: parent.phone,
  };
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

describe("criterion 10: the parent's card in two requests, without N+1", () => {
  it("role check + parent_screen, every child with its status", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await getParent(db, NOW, family.parentId);
    expect(counter.rest).toBe(2);
    expect(screen?.parent).toMatchObject({
      id: family.parentId,
      name: family.name,
      phone: family.phone,
    });
    expect(screen?.children.length).toBeGreaterThanOrEqual(2);
    for (const child of screen?.children ?? [])
      expect(child.status).toMatch(/^(active|expiring|expired|none)$/);
  });

  it("the child's card shows the parent and stays within two requests", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const card = await getClient(db, NOW, family.childId);
    expect(counter.rest).toBe(2);
    expect(card?.parent?.id).toBe(family.parentId);
    // STUB(D-20): the reminder goes to the parent's phone.
    const href = card?.reminder?.message.variants.ru.href;
    if (href) expect(href).toContain(`wa.me/${family.phone.slice(1)}`);
  });

  it("an unknown parent is null, not an error", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    expect(await getParent(db, NOW, randomUUID())).toBeNull();
    expect(await getParentOption(db, randomUUID())).toBeNull();
  });
});

describe("the picker on the client form", () => {
  it("finds the parent by name and by phone in one request each", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    const byName = await searchParents(db, ADMIN, family.name);
    const byPhone = await searchParents(db, ADMIN, family.phone.slice(-7));
    expect(counter.rest).toBe(2);
    expect(byName.ok && byName.data.map((p) => p.id)).toContain(
      family.parentId,
    );
    expect(byPhone.ok && byPhone.data.map((p) => p.id)).toEqual([
      family.parentId,
    ]);
  });

  it("a one-letter text asks nothing and finds nobody", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    expect(await searchParents(db, ADMIN, "а")).toEqual({ ok: true, data: [] });
    expect(counter.rest).toBe(0);
  });

  it("the preselected parent comes with the children's first names", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    const option = await getParentOption(db, family.parentId);
    expect(option?.children?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("refusals", () => {
  it("a visitor without a session gets nothing", async () => {
    const anon: Db = createSupabase<Database>(
      connection.apiUrl,
      connection.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await expect(getParent(anon, NOW, family.parentId)).rejects.toThrow(
      /parent_screen failed/,
    );
    expect(await searchParents(anon, ADMIN, family.name)).toMatchObject({
      ok: false,
    });
  });

  it("an unknown parent cannot be updated", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    expect(
      await updateParent(db, ADMIN, randomUUID(), {
        name: "Никто",
        phone: family.phone,
        messageLocale: "ru",
        note: "",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});
