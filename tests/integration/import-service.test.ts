import { randomInt } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import type { Actor } from "@/features/auth/roles";
import { MAX_FILE_BYTES } from "@/features/import/limits";
import { commitImport, previewImport } from "@/features/import/service";
import { listClients } from "@/features/clients/service";

import { buildXlsx, csvText, utf8 } from "../support/sheets";
import {
  createTempStaff,
  SEED_EMAILS,
  SEED_PASSWORD,
  serviceClient,
  type TempStaff,
} from "../support/staff-accounts";
import { SEED_STAFF } from "./support/roles";

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const NOW = new Date("2026-11-14T09:00:00Z");
const HEADERS = ["Фамилия", "Имя", "Телефон", "Группа", "Дата окончания"];
const NO_GROUPS = {};

/**
 * Committed rows stay in the database, so every run uses its own surname and phones outside the
 * seed range and outside testPhone() (+7700000 9xxx) that other suites use.
 */
const RUN = Array.from(
  { length: 6 },
  () => "абвгдежзиклмнопрст"[randomInt(18)],
).join("");
const phone = () => `+7703${String(randomInt(1e7)).padStart(7, "0")}`;

// A throwaway owner per run: the import limit (10 an hour) counts per employee, so repeated runs
// with the seed owner would hit it.
let staff: TempStaff;
let ownerDb: Db;
let owner: Actor;

async function signIn(email: string, password: string): Promise<Db> {
  const db: Db = createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.code}`);
  return db;
}

beforeAll(async () => {
  staff = await createTempStaff(connection, "owner");
  ownerDb = await signIn(staff.email, staff.password);
  owner = { id: staff.id, role: "owner" };
});

const importedPhones: string[] = [];

afterAll(async () => {
  if (importedPhones.length === 0) return;
  const { data } = await service
    .from("clients")
    .select("id")
    .in("phone", importedPhones);
  const ids = (data ?? []).map((row) => row.id);
  // Payments are append-only, so clients with an opening balance are archived, the rest removed.
  await service
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .in("id", ids);
  const { data: paid } = await service
    .from("payments")
    .select("client_id")
    .in("client_id", ids);
  const keep = new Set((paid ?? []).map((row) => row.client_id));
  const removable = ids.filter((id) => !keep.has(id));
  if (removable.length)
    await service.from("clients").delete().in("id", removable);
});

function csvFile(rows: string[][], name = "notebook.csv") {
  for (const row of rows)
    if (row[2]?.startsWith("+7703")) importedPhones.push(row[2]);
  return { name, bytes: utf8(csvText([HEADERS, ...rows])) };
}

describe("previewImport and commitImport", () => {
  it("skips rows with errors, imports the rest with statuses from the file; again: nothing new", async () => {
    const good = [
      [`${RUN}а`, "Первый", phone(), "", "04.12.2026"],
      [`${RUN}б`, "Второй", phone(), "", "10.11.2026"],
      [`${RUN}в`, "Третий", phone(), "", ""],
    ];
    const file = csvFile([
      ...good,
      [`${RUN}г`, "Плохой", "12345", "", ""],
      ["", "Безфамильный", phone(), "", ""],
    ]);

    const preview = await previewImport(ownerDb, owner, file, null);
    expect(preview.ok && preview.data.counts).toEqual({
      new: 3,
      duplicate: 0,
      error: 2,
    });
    expect(preview.ok && preview.data.importedAt).toBeNull();

    const report = await commitImport(
      ownerDb,
      NOW,
      owner,
      file,
      previewMapping(preview),
      NO_GROUPS,
    );
    expect(report).toMatchObject({
      ok: true,
      data: { created: 3, duplicates: 0, groupsCreated: 0 },
    });
    expect(report.ok && report.data.skipped).toEqual([
      {
        line: 5,
        cells: [`${RUN}г`, "Плохой", "12345", "", ""],
        errors: ["phone_invalid"],
      },
      {
        line: 6,
        cells: ["", "Безфамильный", expect.any(String), "", ""],
        errors: ["last_name_missing"],
      },
    ]);

    const list = await listClients(ownerDb, NOW);
    const imported = list.clients.filter((c) => c.lastName.startsWith(RUN));
    expect(
      imported.map((c) => [c.lastName, c.status, c.endsOn]).sort(),
    ).toEqual([
      [`${RUN}а`, "active", "2026-12-04"],
      [`${RUN}б`, "expired", "2026-11-10"],
      [`${RUN}в`, "none", null],
    ]);

    const again = await previewImport(ownerDb, owner, file, null);
    expect(again.ok && again.data.counts).toEqual({
      new: 0,
      duplicate: 3,
      error: 2,
    });
    expect(again.ok && again.data.importedAt).not.toBeNull();
    const repeat = await commitImport(
      ownerDb,
      NOW,
      owner,
      file,
      previewMapping(again),
      NO_GROUPS,
    );
    expect(repeat).toMatchObject({
      ok: true,
      data: { created: 0, duplicates: 3 },
    });
  });

  it("reads xlsx with Excel day numbers like CSV", async () => {
    const tel = phone();
    importedPhones.push(tel);
    const bytes = buildXlsx([HEADERS, [`${RUN}д`, "Эксель", tel, null, 46025]]);
    const preview = await previewImport(
      ownerDb,
      owner,
      { name: "Клиенты.xlsx", bytes },
      null,
    );
    expect(preview.ok && preview.data.rows[0]).toMatchObject({
      status: "new",
      phone: tel,
      endsOn: "2026-01-03",
    });
  });

  it("asks for columns by hand when headers are not recognised, then reads the rows", async () => {
    const tel = phone();
    importedPhones.push(tel);
    const file = {
      name: "a.csv",
      bytes: utf8(
        csvText([
          ["A", "B", "C"],
          [`${RUN}е`, "Ручной", tel],
        ]),
      ),
    };
    const auto = await previewImport(ownerDb, owner, file, null);
    expect(auto.ok && auto.data.missing).toEqual([
      "lastName",
      "firstName",
      "phone",
    ]);
    expect(auto.ok && auto.data.rows).toEqual([]);
    const mapping = {
      lastName: 0,
      firstName: 1,
      phone: 2,
      group: null,
      endsOn: null,
      locale: null,
    };
    const manual = await previewImport(ownerDb, owner, file, mapping);
    expect(manual.ok && manual.data.counts.new).toBe(1);
    const incomplete = await commitImport(
      ownerDb,
      NOW,
      owner,
      file,
      { ...mapping, phone: null },
      {},
    );
    expect(incomplete).toEqual({ ok: false, error: "mapping_incomplete" });
    const outside = await previewImport(ownerDb, owner, file, {
      ...mapping,
      endsOn: 7,
    });
    expect(outside).toEqual({ ok: false, error: "invalid" });
  });

  it("creates an unknown group only after the owner decides, with coach and price", async () => {
    const group = `Группа ${RUN}`;
    const file = csvFile([[`${RUN}ж`, "Групповой", phone(), group, ""]]);
    const preview = await previewImport(ownerDb, owner, file, null);
    expect(preview.ok && preview.data.unknownGroups).toEqual([group]);
    const mapping = previewMapping(preview);

    expect(await commitImport(ownerDb, NOW, owner, file, mapping, {})).toEqual({
      ok: false,
      error: "groups_unresolved",
    });
    const key = group.toLowerCase();
    const report = await commitImport(ownerDb, NOW, owner, file, mapping, {
      [key]: { kind: "create", coachId: SEED_STAFF.owner, price: 17000 },
    });
    expect(report).toMatchObject({
      ok: true,
      data: { created: 1, groupsCreated: 1 },
    });
    const { data } = await service
      .from("groups")
      .select("id, default_price")
      .eq("name", group);
    expect(data?.[0]?.default_price).toBe(17000);
    // Not to leave a test group among the active ones.
    if (data?.[0])
      await service
        .from("groups")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", data[0].id);
  });

  it("reads the language column: each client gets it, an unknown value is a row error", async () => {
    const rows = [
      [`${RUN}к`, "Язык", phone(), "", "", "қазақша"],
      [`${RUN}л`, "Язык", phone(), "", "", "uz"],
      [`${RUN}м`, "Язык", phone(), "", "", ""],
      [`${RUN}н`, "Язык", phone(), "", "", "английский"],
    ];
    for (const row of rows) if (row[2]) importedPhones.push(row[2]);
    const file = {
      name: "languages.csv",
      bytes: utf8(csvText([[...HEADERS, "Язык"], ...rows])),
    };
    const preview = await previewImport(ownerDb, owner, file, null);
    expect(preview.ok && preview.data.mapping.locale).toBe(5);
    expect(
      preview.ok && preview.data.rows.map((row) => [row.status, row.errors]),
    ).toEqual([
      ["new", []],
      ["new", []],
      ["new", []],
      ["error", ["locale_invalid"]],
    ]);
    const result = await commitImport(
      ownerDb,
      NOW,
      owner,
      file,
      preview.ok ? preview.data.mapping : MAPPING,
      NO_GROUPS,
    );
    expect(result.ok && result.data.created).toBe(3);
    const { data } = await service
      .from("clients")
      .select("last_name, message_locale")
      .like("last_name", `${RUN}%`)
      .eq("first_name", "Язык")
      .order("last_name");
    expect(data?.map((client) => client.message_locale)).toEqual([
      "kk",
      "uz",
      "ru",
    ]);
  });

  it("two parallel imports of the same file create each client once", async () => {
    const file = csvFile([
      [`${RUN}з`, "Параллельный", phone(), "", ""],
      [`${RUN}и`, "Параллельный", phone(), "", ""],
    ]);
    const mapping = {
      lastName: 0,
      firstName: 1,
      phone: 2,
      group: 3,
      endsOn: 4,
      locale: null,
    };
    const results = await Promise.all([
      commitImport(ownerDb, NOW, owner, file, mapping, {}),
      commitImport(ownerDb, NOW, owner, file, mapping, {}),
    ]);
    const created = results.map((r) => (r.ok ? r.data.created : -1));
    expect(created.reduce((a, b) => a + b, 0)).toBe(2);
    const { count } = await service
      .from("clients")
      .select("id", { count: "exact", head: true })
      .like("last_name", `${RUN}%`)
      .eq("first_name", "Параллельный");
    expect(count).toBe(2);
  });

  it("refuses files over 2 MB and of the wrong type before touching the database", async () => {
    const big = {
      name: "big.csv",
      bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41),
    };
    const xls = {
      name: "old.xls",
      bytes: Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]),
    };
    const png = {
      name: "photo.png",
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0]),
    };
    const empty = { name: "a.csv", bytes: new Uint8Array() };
    expect(await previewImport(ownerDb, owner, big, null)).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(await previewImport(ownerDb, owner, xls, null)).toEqual({
      ok: false,
      error: "old_excel",
    });
    expect(await previewImport(ownerDb, owner, png, null)).toEqual({
      ok: false,
      error: "unsupported",
    });
    expect(await previewImport(ownerDb, owner, empty, null)).toEqual({
      ok: false,
      error: "empty",
    });
    expect(await commitImport(ownerDb, NOW, owner, big, MAPPING, {})).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("refuses an admin in the service and in the database", async () => {
    const adminDb = await signIn(SEED_EMAILS.admin, SEED_PASSWORD);
    const admin: Actor = { id: SEED_STAFF.admin, role: "admin" };
    const file = csvFile([[`${RUN}к`, "Админ", phone(), "", ""]]);
    expect(await previewImport(adminDb, admin, file, null)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await commitImport(adminDb, NOW, admin, file, MAPPING, {})).toEqual({
      ok: false,
      error: "forbidden",
    });
    // A forged actor does not help: the database refuses the admin's session.
    expect(await previewImport(adminDb, owner, file, null)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await commitImport(adminDb, NOW, owner, file, MAPPING, {})).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

const MAPPING = {
  lastName: 0,
  firstName: 1,
  phone: 2,
  group: 3,
  endsOn: 4,
  locale: null,
};

function previewMapping(preview: Awaited<ReturnType<typeof previewImport>>) {
  if (!preview.ok) throw new Error(preview.error);
  return preview.data.mapping;
}
