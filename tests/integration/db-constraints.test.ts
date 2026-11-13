import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "./db";
import { rolledBack, SEED_GROUP, SEED_STAFF, type Tx } from "./support/roles";

const sql = connectLocalDb();

afterAll(async () => {
  await sql.end();
});

type ClientRow = {
  phone: string;
  phoneOwner: string;
  parentName: string | null;
};

function insertRawClient(tx: Tx, row: ClientRow) {
  return tx`
    insert into public.clients (
      id, last_name, first_name, phone, phone_owner, parent_name, group_id, started_on, created_by
    ) values (
      ${randomUUID()}, 'Проверка', 'Ограничений', ${row.phone}, ${row.phoneOwner},
      ${row.parentName}, ${SEED_GROUP}, '2026-01-10', ${SEED_STAFF.owner}
    )
  `;
}

describe("criterion 9: client check constraints", () => {
  it.each(["+77001234567", "+77770000000"])("accepts %s", async (phone) => {
    const inserted = await rolledBack(
      sql,
      async (tx) =>
        (
          await insertRawClient(tx, {
            phone,
            phoneOwner: "self",
            parentName: null,
          })
        ).count,
    );
    expect(inserted).toBe(1);
  });

  it.each([
    "87001234567",
    "77001234567",
    "+7700123456",
    "+770012345678",
    "+76001234567",
    "+7 700 123 45 67",
    "+7(700)1234567",
    "",
  ])("rejects phone %j", async (phone) => {
    await expect(
      rolledBack(sql, (tx) =>
        insertRawClient(tx, { phone, phoneOwner: "self", parentName: null }),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "clients_phone_check",
    });
  });

  it("rejects a parent's phone without the parent's name", async () => {
    await expect(
      rolledBack(sql, (tx) =>
        insertRawClient(tx, {
          phone: "+77001234567",
          phoneOwner: "parent",
          parentName: null,
        }),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "clients_parent_name_required",
    });
  });

  it("rejects a blank parent name", async () => {
    await expect(
      rolledBack(sql, (tx) =>
        insertRawClient(tx, {
          phone: "+77001234567",
          phoneOwner: "parent",
          parentName: "  ",
        }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts a parent's phone with the parent's name", async () => {
    const inserted = await rolledBack(
      sql,
      async (tx) =>
        (
          await insertRawClient(tx, {
            phone: "+77001234567",
            phoneOwner: "parent",
            parentName: "Гульнара",
          })
        ).count,
    );
    expect(inserted).toBe(1);
  });

  it("rejects an unknown phone owner", async () => {
    await expect(
      rolledBack(sql, (tx) =>
        insertRawClient(tx, {
          phone: "+77001234567",
          phoneOwner: "grandma",
          parentName: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("criterion 10: trigram search", () => {
  const searchQuery = (tx: Tx, input: string) => tx`
    select id, last_name from public.clients
    where search_text like '%' || public.normalize_search(${input}) || '%'
  `;

  it("finds clients by part of the name, ignoring case and ё", async () => {
    const result = await rolledBack(sql, async (tx) => {
      await tx`
        insert into public.clients (last_name, first_name, phone, phone_owner, started_on, created_by)
        values ('Королёв', 'Семён', '+77001112233', 'self', '2026-01-10', ${SEED_STAFF.owner})
      `;
      return {
        byName: (await searchQuery(tx, "КОРОЛЕВ")).length,
        byFirstName: (await searchQuery(tx, "семен")).length,
        byPhone: (await searchQuery(tx, "1112233")).length,
      };
    });
    expect(result).toEqual({ byName: 1, byFirstName: 1, byPhone: 1 });
  });

  it("finds seed clients by a three-letter fragment", async () => {
    const rows = await rolledBack(sql, (tx) => searchQuery(tx, "ахм"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => String(r.last_name).startsWith("Ахмет"))).toBe(
      true,
    );
  });

  // On ~150 seed rows a sequential scan is genuinely cheaper, so the planner picks it. Disabling
  // seq scans checks that the search predicate matches the trigram index, which is what matters
  // once the table grows.
  it("the search predicate is served by the trigram index", async () => {
    const plan = await rolledBack(sql, async (tx) => {
      await tx`set local enable_seqscan = off`;
      const rows = await tx<{ "QUERY PLAN": unknown }[]>`
        explain (format json)
        select id from public.clients
        where search_text like '%' || public.normalize_search('Ахмет') || '%'
      `;
      return JSON.stringify(rows[0]?.["QUERY PLAN"]);
    });
    expect(plan).toContain("clients_search_text_trgm_idx");
  });
});
