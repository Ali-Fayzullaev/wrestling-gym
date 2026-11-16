import { randomInt, randomUUID } from "node:crypto";

import { createClient as createSupabase } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";
import { AUDIT_ACTIONS, type AuditAction } from "@/features/audit/actions";
import type { Actor } from "@/features/auth/roles";
import { signIn, updatePassword } from "@/features/auth/service";
import { clientInputSchema } from "@/features/clients/schema";
import {
  createClient,
  deleteClient,
  setClientArchived,
  updateClient,
} from "@/features/clients/service";
import { groupInputSchema } from "@/features/groups/schema";
import {
  archiveGroup,
  createGroup,
  moveClients,
  updateGroup,
} from "@/features/groups/service";
import { commitImport, previewImport } from "@/features/import/service";
import {
  cancelRecentPayment,
  recordPayment,
  reversePayment,
} from "@/features/payments/service";
import { reminderSettingsSchema } from "@/features/reminders/schema";
import {
  getReminderSettings,
  saveReminderSettings,
} from "@/features/reminders/service";
import { exportData } from "@/features/reports/service";
import { ru } from "@/i18n/ru";
import { getSettings, updateGymSettings } from "@/features/settings/service";
import {
  addStaff,
  resetStaffPassword,
  updateStaffAccess,
} from "@/features/staff/service";

import { csvText, utf8 } from "../support/sheets";
import { createTempStaff, serviceClient } from "../support/staff-accounts";
import { SEED_GROUP, SEED_STAFF } from "./support/roles";

/**
 * Criterion 1: every mutating action of the services leaves an audit row, and no row holds
 * personal data. The scenarios are a Record over the action catalog, so a new action that has no
 * scenario here does not compile.
 */

const connection = {
  apiUrl: inject("supabaseApiUrl"),
  publishableKey: inject("supabasePublishableKey"),
  secretKey: inject("supabaseSecretKey"),
};
const service = serviceClient(connection);
const NOW = new Date();

// Committed data: names and phones unique per run, so the leak check below is meaningful.
const RUN = Array.from(
  { length: 6 },
  () => "абвгдежзиклмнопрст"[randomInt(18)],
).join("");
const LAST_NAME = `Журналов${RUN}`;
const FIRST_NAME = `Аудит${RUN}`;
const NEW_FIRST_NAME = `Изменён${RUN}`;
const NOTE = `заметка-${RUN}`;
const REASON = `причина-сторно-${RUN}`;
const IMPORT_NAME = `Импортов${RUN}`;
const STAFF_NAME = `Приглашённый ${RUN}`;
const GYM_NAME = `Зал ${RUN}`;
const TEMPLATE_TAIL = ` ${RUN}-хвост`;
const INVITE_EMAIL = `invite-${randomUUID()}@example.test`;
const TEMP_PASSWORD = `temp-${RUN}-${randomUUID()}`;
const RESET_PASSWORD = `reset-${RUN}-${randomUUID()}`;
const phone = () => `+7704${String(randomInt(1e7)).padStart(7, "0")}`;
const PHONES = [phone(), phone(), phone()] as const;

/** Values that must never reach audit_log.details. */
const SECRETS = [
  LAST_NAME,
  FIRST_NAME,
  NEW_FIRST_NAME,
  NOTE,
  REASON,
  IMPORT_NAME,
  STAFF_NAME,
  GYM_NAME,
  TEMPLATE_TAIL.trim(),
  INVITE_EMAIL,
  TEMP_PASSWORD,
  RESET_PASSWORD,
  ...PHONES,
];

let staffEmail: string;
let password: string;
let ownerId: string;
let db: Db;
let actor: Actor;

const state: {
  groupId?: string;
  clients: string[];
  paymentId?: string;
  invitedId?: string;
} = { clients: [] };

function freshClient(): Db {
  return createSupabase<Database>(
    connection.apiUrl,
    connection.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function must<T>(
  result: { ok: true; data: T } | { ok: false; error: string },
): T {
  if (!result.ok) throw new Error(`service refused: ${result.error}`);
  return result.data;
}

function clientInput(first: string, phoneNumber: string) {
  return clientInputSchema.parse({
    lastName: LAST_NAME,
    firstName: first,
    birthDate: "",
    phone: phoneNumber,
    phoneOwner: "self",
    parentName: "",
    groupId: SEED_GROUP,
    startedOn: "2026-11-01",
    note: NOTE,
    consents: ["data_processing"],
  });
}

function groupInput(price: number) {
  return groupInputSchema.parse({
    name: `Группа ${RUN}`,
    coachId: SEED_STAFF.admin,
    schedule: [{ day: 2, start: "18:00", end: "19:30" }],
    defaultPrice: price,
    capacity: null,
  });
}

async function newClient(first: string, phoneNumber: string) {
  const { id } = must(
    await createClient(db, actor, clientInput(first, phoneNumber)),
  );
  state.clients.push(id);
  return id;
}

async function payment() {
  const { id } = must(
    await recordPayment(db, actor, {
      clientId: defined(state.clients[0]),
      amount: 15000,
      method: "kaspi",
      idempotencyKey: randomUUID(),
    }),
  );
  return id;
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("scenario order broken");
  return value;
}

async function changeReminders(change: "days" | "text") {
  const screen = await getReminderSettings(db, NOW);
  const days = [...screen.context.reminderDays].sort((a, b) => b - a);
  const templates = screen.context.templates.map((t) => ({
    id: t.id,
    body: t.body,
  }));
  const restore = reminderSettingsSchema.parse({
    firstDays: String(days[0]),
    secondDays: days[1] === undefined ? "" : String(days[1]),
    templates,
  });
  const changed = reminderSettingsSchema.parse(
    change === "days"
      ? {
          firstDays: String((days[0] ?? 7) + 1),
          secondDays: days[1] === undefined ? "" : String(days[1]),
          templates,
        }
      : {
          firstDays: String(days[0]),
          secondDays: days[1] === undefined ? "" : String(days[1]),
          templates: templates.map((t, index) =>
            index === 0 ? { ...t, body: `${t.body}${TEMPLATE_TAIL}` } : t,
          ),
        },
  );
  expect(await saveReminderSettings(db, actor, changed)).toMatchObject({
    ok: true,
  });
  // Global settings: put them back for the suites that follow.
  expect(await saveReminderSettings(db, actor, restore)).toMatchObject({
    ok: true,
  });
}

async function access(role: "owner" | "admin", active: boolean) {
  expect(
    await updateStaffAccess(db, {
      staffId: defined(state.invitedId),
      role,
      active,
    }),
  ).toEqual({ ok: true });
}

/** Runs in this order; each scenario may rely on the ones before it. */
const SCENARIOS: Record<AuditAction, () => Promise<void>> = {
  "staff.login": async () => {
    const result = await signIn({ db: freshClient(), admin: service }, NOW, {
      email: staffEmail,
      password,
      ip: `198.51.100.${randomInt(1, 255)}`,
    });
    expect(result).toMatchObject({ ok: true });
  },
  "staff.password_change": async () => {
    expect(
      await updatePassword({ db, admin: service }, actor, `pw-${randomUUID()}`),
    ).toMatchObject({ ok: true });
  },
  "group.create": async () => {
    state.groupId = must(await createGroup(db, actor, groupInput(16000))).id;
  },
  "group.update": async () => {
    must(
      await updateGroup(db, actor, defined(state.groupId), groupInput(17000)),
    );
  },
  "client.create": async () => {
    await newClient(FIRST_NAME, PHONES[0]);
    await newClient(FIRST_NAME, PHONES[1]);
  },
  "client.update": async () => {
    must(
      await updateClient(
        db,
        actor,
        defined(state.clients[0]),
        clientInput(NEW_FIRST_NAME, PHONES[0]),
      ),
    );
  },
  "client.move": async () => {
    must(
      await moveClients(db, actor, {
        clientIds: [defined(state.clients[0])],
        targetGroupId: defined(state.groupId),
      }),
    );
    // Back to the seed group, so the test group can be archived empty.
    must(
      await moveClients(db, actor, {
        clientIds: [defined(state.clients[0])],
        targetGroupId: SEED_GROUP,
      }),
    );
  },
  "client.archive": async () => {
    must(
      await setClientArchived(db, actor, {
        clientId: defined(state.clients[1]),
        archived: true,
      }),
    );
  },
  "client.restore": async () => {
    must(
      await setClientArchived(db, actor, {
        clientId: defined(state.clients[1]),
        archived: false,
      }),
    );
  },
  "client.delete": async () => {
    must(
      await deleteClient(db, actor, {
        clientId: defined(state.clients[1]),
        reason: "duplicate",
        lastName: LAST_NAME,
      }),
    );
  },
  "payment.create": async () => {
    state.paymentId = await payment();
  },
  "payment.cancel": async () => {
    must(
      await cancelRecentPayment(db, actor, {
        paymentId: defined(state.paymentId),
        idempotencyKey: randomUUID(),
      }),
    );
  },
  "payment.reverse": async () => {
    must(
      await reversePayment(db, actor, {
        paymentId: await payment(),
        reason: REASON,
        idempotencyKey: randomUUID(),
      }),
    );
  },
  "group.archive": async () => {
    must(
      await archiveGroup(db, actor, {
        groupId: defined(state.groupId),
        force: true,
      }),
    );
  },
  "client.import": async () => {
    const file = {
      name: "notebook.csv",
      bytes: utf8(
        csvText([
          ["Фамилия", "Имя", "Телефон"],
          [IMPORT_NAME, FIRST_NAME, PHONES[2]],
        ]),
      ),
    };
    const preview = must(await previewImport(db, actor, file, null));
    const report = must(
      await commitImport(db, NOW, actor, file, preview.mapping, {}),
    );
    expect(report.created).toBe(1);
  },
  "report.export": async () => {
    must(
      await exportData(db, NOW, { data: "clients", format: "csv" }, ru.reports),
    );
  },
  "settings.update": async () => {
    await changeReminders("days");
    const before = await getSettings(db);
    expect(
      await updateGymSettings(db, {
        gymName: GYM_NAME,
        gymWhatsapp: "+77011234567",
      }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await updateGymSettings(db, {
        gymName: before.gymName,
        gymWhatsapp: before.gymWhatsapp,
      }),
    ).toEqual({ ok: true, changed: true });
  },
  "template.update": async () => {
    await changeReminders("text");
  },
  "staff.invite": async () => {
    expect(
      await addStaff(
        { db, admin: service },
        {
          email: INVITE_EMAIL,
          fullName: STAFF_NAME,
          role: "admin",
          password: TEMP_PASSWORD,
        },
      ),
    ).toEqual({ ok: true });
    const { data } = await service
      .from("staff")
      .select("id")
      .eq("full_name", STAFF_NAME)
      .single();
    state.invitedId = data?.id;
  },
  "staff.password_reset": async () => {
    expect(
      await resetStaffPassword(
        { db, admin: service },
        { staffId: defined(state.invitedId), password: RESET_PASSWORD },
      ),
    ).toEqual({ ok: true });
  },
  "staff.role_change": async () => {
    await access("owner", true);
    await access("admin", true);
  },
  "staff.deactivate": async () => {
    await access("admin", false);
  },
  "staff.activate": async () => {
    await access("admin", true);
    await access("admin", false);
  },
};

type AuditRow = { action: string; details: unknown; entity_id: string | null };

let rows: AuditRow[] = [];

beforeAll(async () => {
  // A throwaway owner: imports and exports are limited per employee per hour.
  const staff = await createTempStaff(connection, "owner");
  staffEmail = staff.email;
  password = staff.password;
  ownerId = staff.id;
  actor = { id: staff.id, role: "owner" };
  db = freshClient();
  const { error } = await db.auth.signInWithPassword({
    email: staff.email,
    password: staff.password,
  });
  if (error) throw new Error(`sign-in failed: ${error.code}`);

  // Object literal order, not the catalog order: later scenarios use what earlier ones made.
  for (const scenario of Object.values(SCENARIOS)) await scenario();

  const { data, error: readError } = await service
    .from("audit_log")
    .select("action, details, entity_id")
    .eq("actor_id", ownerId);
  if (readError) throw new Error(`audit read failed: ${readError.code}`);
  rows = data;
}, 60_000);

afterAll(async () => {
  // The imported client has no payments; the first one keeps its reversed payments (append-only).
  await service
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("last_name", LAST_NAME);
  await service.from("clients").delete().eq("last_name", IMPORT_NAME);
});

describe("criterion 1: every mutating action writes an audit row without personal data", () => {
  it.each(AUDIT_ACTIONS.map((action) => [action]))(
    "%s leaves an audit row by the acting employee",
    (action) => {
      expect(
        rows.filter((row) => row.action === action).length,
      ).toBeGreaterThan(0);
    },
  );

  it("no audit row of the run holds a name, phone, email, note, reason or text", () => {
    const text = JSON.stringify(rows);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("client.import records counts, not rows", () => {
    const imported = rows.find((row) => row.action === "client.import");
    expect(imported?.details).toMatchObject({ rows: 1, created: 1 });
  });
});
