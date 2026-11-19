import { randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { afterAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { childrenInputSchema } from "@/features/clients/schema";
import { createChildren } from "@/features/clients/service";

import {
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
} from "../support/staff-accounts";
import { familyPhone } from "./support/families";
import { SEED_GROUP, SEED_STAFF } from "./support/roles";

// Step 24 (D-24): createChildren() through the database API, as the Server Action calls it.

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const ADMIN = { id: SEED_STAFF.admin, role: "admin" } as const;

const createdParents: string[] = [];

afterAll(async () => {
  if (createdParents.length) {
    await service.from("clients").delete().in("parent_id", createdParents);
    await service.from("parents").delete().in("id", createdParents);
  }
});

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

const child = (firstName: string, groupId = SEED_GROUP) => ({
  lastName: "Сервисная",
  firstName,
  phone: "",
  groupId,
  startedOn: "2026-11-19",
  birthDate: "",
  note: "",
});

function input(overrides: Record<string, unknown> = {}) {
  return childrenInputSchema.parse({
    parentMode: "new",
    parentId: "",
    newParentName: "Сервисная мама",
    newParentPhone: familyPhone(),
    newParentLocale: "ru",
    requestKey: randomUUID(),
    children: [child("Арман"), child("Дана")],
    ...overrides,
  });
}

describe("createChildren", () => {
  it("one request saves the parent and both children; a repeat returns them", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    const request = input();
    const first = await createChildren(db, ADMIN, request);
    if (!first.ok) throw new Error(`createChildren failed: ${first.error}`);
    createdParents.push(first.data.parentId);
    expect(first.data.childIds).toHaveLength(2);
    expect(counter.rest).toBe(1);

    await expect(createChildren(db, ADMIN, request)).resolves.toEqual(first);
    const { data } = await service
      .from("clients")
      .select("id, parent_id")
      .eq("parent_id", first.data.parentId);
    expect(data).toHaveLength(2);
  });

  it("without a session the database refuses, whatever the actor says", async () => {
    const anon: Db = createSupabase<Database>(
      connection.apiUrl,
      connection.publishableKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await expect(createChildren(anon, ADMIN, input())).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("an unknown parent and an unknown group are named; nothing is saved", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    await expect(
      createChildren(
        db,
        ADMIN,
        input({ parentMode: "existing", parentId: randomUUID() }),
      ),
    ).resolves.toEqual({ ok: false, error: "parent_not_found" });

    const phone = familyPhone();
    await expect(
      createChildren(
        db,
        ADMIN,
        input({
          newParentPhone: phone,
          children: [child("Арман"), child("Дана", randomUUID())],
        }),
      ),
    ).resolves.toEqual({ ok: false, error: "group_not_found" });
    const { data } = await service
      .from("parents")
      .select("id")
      .eq("phone", phone);
    expect(data).toEqual([]);
  });
});
