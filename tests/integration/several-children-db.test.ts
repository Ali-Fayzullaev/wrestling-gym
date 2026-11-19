import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";

import { connectLocalDb } from "./db";
import { familyPhone, insertParent } from "./support/families";
import {
  admin,
  asActor,
  become,
  owner,
  rolledBack,
  SEED_GROUP,
  SEED_STAFF,
  type Tx,
} from "./support/roles";

// Step 24 (D-24): a parent and several children in one save, create_children().

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

const TODAY = "2026-03-15";
const INVALID = { code: "22023" };
const PERMISSION_DENIED = { code: "42501" };

type Created = { parent_id: string; child_ids: string[]; created: boolean };

type ChildRow = {
  last_name?: string;
  first_name?: string;
  phone?: string | null;
  birth_date?: string | null;
  group_id?: string | null;
  started_on?: string;
};

function child(firstName: string, row: ChildRow = {}): ChildRow {
  return {
    last_name: "Многодетный",
    first_name: firstName,
    phone: null,
    birth_date: "2016-05-01",
    group_id: SEED_GROUP,
    started_on: TODAY,
    ...row,
  };
}

const newParent = () => ({
  name: "Гульнара",
  phone: familyPhone(),
  message_locale: "kk",
});

async function createChildren(
  tx: Tx,
  args: {
    parentId?: string;
    newParent?: Record<string, string>;
    children: unknown;
    key?: string;
  },
): Promise<Created> {
  const [row] = await tx<{ r: Created }[]>`
    select public.create_children(
      ${args.parentId ?? null}::uuid,
      ${args.newParent ? tx.json(args.newParent) : null}::jsonb,
      ${tx.json(args.children as postgres.JSONValue)}::jsonb,
      ${args.key ?? randomUUID()}::uuid
    ) as r
  `;
  if (!row) throw new Error("create_children returned nothing");
  return row.r;
}

async function childrenOf(tx: Tx, parentId: string) {
  return tx<{ id: string; first_name: string; parent_id: string }[]>`
    select id, first_name, parent_id from public.clients
    where parent_id = ${parentId} order by request_position
  `;
}

const countParentsByPhone = async (tx: Tx, phone: string) => {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.parents where phone = ${phone}
  `;
  return row?.n ?? 0;
};

describe("criterion 1: a new parent and three children in one save", () => {
  it("one parent, three children with its parent_id, in the given order", async () => {
    const result = await asActor(sql, admin, async (tx) => {
      const parent = newParent();
      const created = await createChildren(tx, {
        newParent: parent,
        children: [child("Арман"), child("Дана"), child("Тимур")],
      });
      return {
        created,
        parents: await countParentsByPhone(tx, parent.phone),
        rows: await childrenOf(tx, created.parent_id),
      };
    });
    expect(result.parents).toBe(1);
    expect(result.created.created).toBe(true);
    expect(result.rows.map((row) => row.first_name)).toEqual([
      "Арман",
      "Дана",
      "Тимур",
    ]);
    expect(result.rows.map((row) => row.id)).toEqual(result.created.child_ids);
    expect(new Set(result.rows.map((row) => row.parent_id))).toEqual(
      new Set([result.created.parent_id]),
    );
  });
});

describe("criterion 2: an existing parent and two children", () => {
  it("the children join the parent on file; no new parent", async () => {
    const result = await rolledBack(sql, async (tx) => {
      const parentId = await insertParent(tx);
      await become(tx, owner);
      const created = await createChildren(tx, {
        parentId,
        children: [child("Алия"), child("Ержан", { group_id: null })],
      });
      return { parentId, created, rows: await childrenOf(tx, parentId) };
    });
    expect(result.created.parent_id).toBe(result.parentId);
    expect(result.rows).toHaveLength(2);
  });
});

describe("criterion 3: an error in one child saves nobody", () => {
  it.each([
    ["no first name", child("", {})],
    ["a wrong phone", child("Тимур", { phone: "87011234567" })],
    ["no start date", child("Тимур", { started_on: undefined })],
    ["an unknown group", child("Тимур", { group_id: randomUUID() })],
  ])(
    "%s in the third child: neither children nor the new parent",
    async (_, bad) => {
      const parent = newParent();
      const outcome = await rolledBack(sql, async (tx) => {
        await become(tx, admin);
        await tx`savepoint attempt`;
        const error = await createChildren(tx, {
          newParent: parent,
          children: [child("Арман"), child("Дана"), bad],
        }).catch((caught: unknown) => caught);
        await tx`rollback to savepoint attempt`;
        return {
          error,
          parents: await countParentsByPhone(tx, parent.phone),
          children: await tx`
          select 1 from public.clients where last_name = 'Многодетный'
        `,
        };
      });
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.parents).toBe(0);
      expect(outcome.children).toHaveLength(0);
    },
  );

  it("the error codes the screen maps: check, not-null, group", async () => {
    await expect(
      asActor(sql, admin, (tx) =>
        createChildren(tx, {
          newParent: newParent(),
          children: [child("Арман"), child("")],
        }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      asActor(sql, admin, (tx) =>
        createChildren(tx, {
          newParent: newParent(),
          children: [child("Арман", { group_id: randomUUID() })],
        }),
      ),
    ).rejects.toMatchObject({ code: "P0002", message: "group_not_found" });
  });
});

describe("criterion 4: a repeated request and parallel requests with one key", () => {
  it("a repeat returns the same children and adds nothing", async () => {
    const result = await asActor(sql, admin, async (tx) => {
      const key = randomUUID();
      const parent = newParent();
      const children = [child("Арман"), child("Дана")];
      const first = await createChildren(tx, {
        newParent: parent,
        children,
        key,
      });
      const second = await createChildren(tx, {
        newParent: parent,
        children,
        key,
      });
      return {
        first,
        second,
        parents: await countParentsByPhone(tx, parent.phone),
        rows: await childrenOf(tx, first.parent_id),
      };
    });
    expect(result.second).toEqual({ ...result.first, created: false });
    expect(result.parents).toBe(1);
    expect(result.rows).toHaveLength(2);
  });

  it("the unique index stops a second set with the same key, even past the function", async () => {
    await expect(
      asActor(sql, admin, async (tx) => {
        const key = randomUUID();
        const created = await createChildren(tx, {
          newParent: newParent(),
          children: [child("Арман")],
          key,
        });
        await tx`
          insert into public.clients (
            last_name, first_name, parent_id, started_on, created_by, request_key, request_position
          ) values (
            'Многодетный', 'Двойник', ${created.parent_id}, ${TODAY}, ${SEED_STAFF.admin},
            ${key}, 1
          )
        `;
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("five parallel requests with one key leave one parent and its two children", async () => {
    const key = randomUUID();
    const parent = newParent();
    const dbs = Array.from({ length: 5 }, () =>
      postgres(inject("databaseUrl"), { max: 1, onnotice: () => undefined }),
    );
    let parentId = "";
    try {
      const results = await Promise.all(
        dbs.map((db) =>
          db.begin(async (tx) => {
            await become(tx, admin);
            return createChildren(tx, {
              newParent: parent,
              children: [child("Арман"), child("Дана")],
              key,
            });
          }),
        ),
      );
      parentId = results[0]?.parent_id ?? "";
      expect(new Set(results.map((r) => r.parent_id)).size).toBe(1);
      expect(new Set(results.map((r) => r.child_ids.join())).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      const [counts] = await sql<{ parents: number; children: number }[]>`
        select
          (select count(*)::int from public.parents where phone = ${parent.phone}) as parents,
          (select count(*)::int from public.clients where request_key = ${key}) as children
      `;
      expect(counts).toEqual({ parents: 1, children: 2 });
    } finally {
      await Promise.all(dbs.map((db) => db.end()));
      // Committed rows: removed by the table owner so the seed stays as it was.
      await sql`delete from public.clients where request_key = ${key}`;
      if (parentId)
        await sql`delete from public.parents where id = ${parentId}`;
    }
  });
});

describe("criterion 5: no children or more than ten are refused", () => {
  it.each([
    ["no children", []],
    ["eleven children", Array.from({ length: 11 }, (_, i) => child(`Р${i}`))],
    ["not a list", { first_name: "Арман" }],
    ["a list of strings", ["Арман"]],
  ])("%s", async (_, children) => {
    await expect(
      asActor(sql, admin, (tx) =>
        createChildren(tx, { newParent: newParent(), children }),
      ),
    ).rejects.toMatchObject(INVALID);
  });

  it("ten children are accepted", async () => {
    const created = await asActor(sql, admin, (tx) =>
      createChildren(tx, {
        newParent: newParent(),
        children: Array.from({ length: 10 }, (_, i) => child(`Р${i}`)),
      }),
    );
    expect(created.child_ids).toHaveLength(10);
  });

  it("no parent, or both kinds of parent at once, is refused", async () => {
    await expect(
      asActor(sql, admin, (tx) =>
        createChildren(tx, { children: [child("Арман")] }),
      ),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_parent" });
    await expect(
      rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx);
        await become(tx, admin);
        await createChildren(tx, {
          parentId,
          newParent: newParent(),
          children: [child("Арман")],
        });
      }),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_parent" });
  });
});

describe("criterion 6: who may create children", () => {
  it.each([
    ["anon", "anon" as const],
    ["a signed-in user who is not staff", { userId: randomUUID() }],
  ])("%s is refused by the database", async (_, actor) => {
    await expect(
      asActor(sql, actor, (tx) =>
        createChildren(tx, {
          newParent: newParent(),
          children: [child("Арман")],
        }),
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("an archived parent is refused", async () => {
    await expect(
      rolledBack(sql, async (tx) => {
        const parentId = await insertParent(tx, { archived: true });
        await become(tx, admin);
        await createChildren(tx, { parentId, children: [child("Арман")] });
      }),
    ).rejects.toMatchObject({ code: "P0002", message: "parent_not_found" });
  });

  it("a request key cannot be changed afterwards", async () => {
    await expect(
      asActor(sql, owner, async (tx) => {
        const created = await createChildren(tx, {
          newParent: newParent(),
          children: [child("Арман")],
        });
        await tx`
          update public.clients set request_key = ${randomUUID()}
          where id = ${created.child_ids[0] ?? ""}
        `;
      }),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

describe("criterion 7: the audit log, ids only", () => {
  it("a row per child and one for the new parent, without names or phones", async () => {
    const parent = newParent();
    const result = await asActor(sql, admin, async (tx) => {
      const created = await createChildren(tx, {
        newParent: parent,
        children: [child("Арман"), child("Дана", { phone: familyPhone() })],
      });
      // The audit log is readable by the owner only; checked here as the table owner.
      await become(tx, "postgres");
      const rows = await tx<
        {
          action: string;
          entity_id: string;
          actor_id: string;
          details: unknown;
        }[]
      >`
        select action, entity_id, actor_id, details from public.audit_log
        where entity_id = any(${[created.parent_id, ...created.child_ids]}::uuid[])
      `;
      return { created, rows };
    });
    const { created, rows } = result;
    expect(
      rows
        .filter((row) => row.action === "parent.create")
        .map((r) => r.entity_id),
    ).toEqual([created.parent_id]);
    expect(
      rows
        .filter((row) => row.action === "client.create")
        .map((r) => r.entity_id)
        .sort(),
    ).toEqual([...created.child_ids].sort());
    expect(rows.every((row) => row.actor_id === SEED_STAFF.admin)).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of [
      "Арман",
      "Дана",
      "Многодетный",
      parent.name,
      parent.phone,
    ])
      expect(text).not.toContain(secret);
  });
});
