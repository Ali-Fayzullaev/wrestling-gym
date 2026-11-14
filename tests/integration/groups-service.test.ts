import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { authorizeStaff } from "@/features/auth/service";
import type { GroupInput } from "@/features/groups/schema";
import {
  archiveGroup,
  createGroup,
  getGroup,
  listGroups,
  moveClients,
  updateGroup,
} from "@/features/groups/service";

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
const NOW = new Date("2026-11-13T09:00:00Z");
const OWNER = { id: SEED_STAFF.owner, role: "owner" } as const;
const ADMIN = { id: SEED_STAFF.admin, role: "admin" } as const;

const createdGroups: string[] = [];
const createdClients: string[] = [];

afterAll(async () => {
  // Test rows only; the audit log keeps its entries (append-only, no foreign key to groups).
  if (createdClients.length)
    await service.from("clients").delete().in("id", createdClients);
  if (createdGroups.length)
    await service.from("groups").delete().in("id", createdGroups);
});

/** A signed-in client that counts its requests to the database API (PostgREST). */
async function signedIn(email: string) {
  const counter = { rest: 0 };
  const db: Db = createClient<Database>(
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

function groupInput(name: string): GroupInput {
  return {
    name,
    coachId: SEED_STAFF.admin,
    schedule: [{ day: 2, start: "18:00", end: "19:00" }],
    defaultPrice: 16000,
    capacity: 2,
  };
}

async function seedClient(groupId: string): Promise<string> {
  const id = randomUUID();
  const { error } = await service.from("clients").insert({
    id,
    last_name: "Тестов",
    first_name: "Перевод",
    phone: `+7700000${String(9500 + createdClients.length).padStart(4, "0")}`,
    phone_owner: "self",
    group_id: groupId,
    started_on: "2026-11-01",
    created_by: SEED_STAFF.owner,
  });
  if (error) throw new Error(`client insert failed: ${error.code}`);
  createdClients.push(id);
  return id;
}

describe("criterion 8: a groups screen costs at most two database requests", () => {
  it("list: role check + groups_screen", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await listGroups(db, NOW);
    expect(screen.groups.length).toBeGreaterThan(0);
    expect(screen.coaches.length).toBeGreaterThan(0);
    expect(counter.rest).toBeLessThanOrEqual(2);
  });

  it("group: role check + group_screen", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.owner);
    await authorizeStaff(db, ["owner", "admin"]);
    const screen = await getGroup(db, NOW, SEED_GROUP);
    expect(screen?.group.id).toBe(SEED_GROUP);
    expect(screen?.members.length).toBe(screen?.group.members);
    expect(counter.rest).toBeLessThanOrEqual(2);
  });

  it("an unknown group is null, not an error", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    await expect(getGroup(db, NOW, randomUUID())).resolves.toBeNull();
  });
});

describe("criterion 1: the service refuses an admin before the database does", () => {
  it("createGroup, updateGroup and archiveGroup return forbidden without a request", async () => {
    const { db, counter } = await signedIn(SEED_EMAILS.admin);
    await expect(createGroup(db, ADMIN, groupInput("Чужая"))).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    await expect(
      updateGroup(db, ADMIN, SEED_GROUP, groupInput("Чужая")),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(
      archiveGroup(db, ADMIN, { groupId: SEED_GROUP, force: true }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(counter.rest).toBe(0);
  });

  it("an admin session claiming to be the owner is still refused by the database", async () => {
    const { db } = await signedIn(SEED_EMAILS.admin);
    await expect(
      createGroup(db, { ...ADMIN, role: "owner" }, groupInput("Подделка")),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(
      archiveGroup(
        db,
        { ...ADMIN, role: "owner" },
        { groupId: SEED_GROUP, force: true },
      ),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
  });
});

describe("owner manages a group end to end through the service", () => {
  it("creates, renames and archives", async () => {
    const { db } = await signedIn(SEED_EMAILS.owner);
    const name = `Сервис ${randomUUID().slice(0, 8)}`;
    const created = await createGroup(db, OWNER, groupInput(name));
    if (!created.ok) throw new Error(created.error);
    createdGroups.push(created.data.id);

    let list = await listGroups(db, NOW);
    expect(list.groups.find((g) => g.id === created.data.id)).toMatchObject({
      name,
      capacity: 2,
      members: 0,
      defaultPrice: 16000,
      schedule: [{ day: 2, start: "18:00", end: "19:00" }],
    });

    await expect(
      updateGroup(db, OWNER, created.data.id, {
        ...groupInput(`${name} 2`),
        capacity: null,
      }),
    ).resolves.toEqual({ ok: true, data: null });
    const group = await getGroup(db, NOW, created.data.id);
    expect(group?.group).toMatchObject({ name: `${name} 2`, capacity: null });

    await expect(
      archiveGroup(db, OWNER, { groupId: created.data.id, force: false }),
    ).resolves.toEqual({ ok: true, data: { archived: true } });
    list = await listGroups(db, NOW);
    expect(list.groups.some((g) => g.id === created.data.id)).toBe(false);
  });

  it("reports a missing group and a deactivated coach as codes", async () => {
    const { db } = await signedIn(SEED_EMAILS.owner);
    await expect(
      updateGroup(db, OWNER, randomUUID(), groupInput("Нет такой")),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    await expect(
      createGroup(db, OWNER, { ...groupInput("Х"), coachId: randomUUID() }),
    ).resolves.toEqual({ ok: false, error: "coach_not_found" });
  });
});

describe("an admin moves clients through the service", () => {
  it("moves, reports the new head count and refuses an unknown client", async () => {
    const { db: ownerDb } = await signedIn(SEED_EMAILS.owner);
    const from = await createGroup(ownerDb, OWNER, groupInput("Откуда"));
    const to = await createGroup(ownerDb, OWNER, groupInput("Куда"));
    if (!from.ok || !to.ok) throw new Error("group setup failed");
    createdGroups.push(from.data.id, to.data.id);
    const clients = [
      await seedClient(from.data.id),
      await seedClient(from.data.id),
      await seedClient(from.data.id),
    ];

    const { db } = await signedIn(SEED_EMAILS.admin);
    await expect(
      moveClients(db, ADMIN, {
        clientIds: [defined(clients[0]), randomUUID()],
        targetGroupId: to.data.id,
      }),
    ).resolves.toEqual({ ok: false, error: "client_not_found" });

    await expect(
      moveClients(db, ADMIN, {
        clientIds: clients,
        targetGroupId: to.data.id,
      }),
    ).resolves.toEqual({
      ok: true,
      data: { moved: 3, targetMembers: 3, targetCapacity: 2 },
    });
    const target = await getGroup(db, NOW, to.data.id);
    expect(target?.group.members).toBe(3);
    const source = await getGroup(db, NOW, from.data.id);
    expect(source?.members).toEqual([]);
  });
});
