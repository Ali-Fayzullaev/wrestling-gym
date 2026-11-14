import { z } from "zod";

import type { SubscriptionStatus } from "@/components/status-badge";
import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";
import { PAYMENT_METHODS } from "@/features/payments/form-fields";
import type { HistoryRow } from "@/features/payments/history";
import {
  parseReminderEvents,
  type ReminderEvent,
} from "@/features/reminders/service";
import { businessDate } from "@/lib/dates";

import type { ClientRow, GroupOption } from "./filters";
import { STATUSES } from "./filters";
import type { ConsentKind, DeleteReason, PhoneOwner } from "./form-fields";
import { CONSENT_KINDS, PHONE_OWNERS } from "./form-fields";
import type {
  ArchiveClientInput,
  ClientInput,
  DeleteClientInput,
  PhoneCheckInput,
} from "./schema";

/**
 * The list is loaded whole and searched in the browser up to this many clients (the gym has
 * 100–200). Past it the screen says the list is cut; server-side paging would be the next step.
 */
export const CLIENTS_LIST_LIMIT = 500;

export type ClientError =
  | "forbidden"
  | "not_found"
  | "group_not_found"
  | "confirmation_mismatch"
  | "invalid"
  | "unavailable";

export type Result<T> =
  { ok: true; data: T } | { ok: false; error: ClientError };

// Shapes of clients_screen() / client_screen() / phone_duplicates()
// (supabase/migrations/*_clients_management.sql). The database returns jsonb, so the reply is
// checked rather than trusted.
const status = z.enum(STATUSES);

const clientsScreenShape = z.object({
  total: z.number(),
  clients: z.array(
    z.object({
      id: z.string(),
      last_name: z.string(),
      first_name: z.string(),
      phone: z.string(),
      group_id: z.string().nullable(),
      archived: z.boolean(),
      status,
      ends_on: z.string().nullable(),
    }),
  ),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      coach_id: z.string(),
      archived: z.boolean(),
      price: z.number(),
    }),
  ),
  coaches: z.array(z.object({ id: z.string(), name: z.string() })),
});

const clientScreenShape = z.object({
  client: z.object({
    id: z.string(),
    last_name: z.string(),
    first_name: z.string(),
    birth_date: z.string().nullable(),
    phone: z.string(),
    phone_owner: z.enum(PHONE_OWNERS),
    parent_name: z.string().nullable(),
    group_id: z.string().nullable(),
    started_on: z.string(),
    note: z.string(),
    archived: z.boolean(),
  }),
  group: z
    .object({
      id: z.string(),
      name: z.string(),
      coach_name: z.string(),
      archived: z.boolean(),
      price: z.number(),
    })
    .nullable(),
  subscription: z.object({
    status,
    period_start: z.string().nullable(),
    ends_on: z.string().nullable(),
    days_left: z.number().nullable(),
  }),
  consents: z.array(
    z.object({
      kind: z.enum(CONSENT_KINDS),
      given_on: z.string(),
      recorded_by: z.string(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["payment", "reversal"]),
      amount: z.number(),
      method: z.enum(PAYMENT_METHODS),
      period_start: z.string(),
      period_end: z.string(),
      reverses_id: z.string().nullable(),
      reason: z.string().nullable(),
      created_at: z.string(),
      created_by: z.string(),
      created_by_name: z.string(),
    }),
  ),
  // Checked by the reminders feature, which owns the event shape.
  reminders: z.unknown(),
  groups: z.array(z.object({ id: z.string(), name: z.string() })),
});

const duplicatesShape = z.array(
  z.object({
    id: z.string(),
    last_name: z.string(),
    first_name: z.string(),
    archived: z.boolean(),
  }),
);

export type Coach = { id: string; name: string };

export type ClientsScreen = {
  clients: ClientRow[];
  groups: GroupOption[];
  coaches: Coach[];
  /** All clients in the database; more than clients.length when the list was cut. */
  total: number;
};

export type ActiveGroup = { id: string; name: string };

export type Consent = {
  kind: ConsentKind;
  givenOn: string;
  recordedBy: string;
};

export type ClientDetails = {
  id: string;
  lastName: string;
  firstName: string;
  birthDate: string | null;
  phone: string;
  phoneOwner: PhoneOwner;
  parentName: string | null;
  groupId: string | null;
  startedOn: string;
  note: string;
  archived: boolean;
};

export type ClientScreen = {
  client: ClientDetails;
  group: {
    id: string;
    name: string;
    coachName: string;
    archived: boolean;
    /** Price of a month, offered in the payment form. */
    price: number;
  } | null;
  subscription: {
    status: SubscriptionStatus;
    periodStart: string | null;
    endsOn: string | null;
    daysLeft: number | null;
  };
  consents: Consent[];
  /** Payments and reversals, newest first. */
  payments: HistoryRow[];
  /** Reminder events (chat opened, marked sent), newest first. */
  reminders: ReminderEvent[];
  /** Active groups, for the edit form. */
  groups: ActiveGroup[];
};

export type PhoneDuplicate = {
  id: string;
  lastName: string;
  firstName: string;
  archived: boolean;
};

/** The clients list with status, groups and coaches: one database request. */
export async function listClients(
  db: Db,
  now: Date,
  limit = CLIENTS_LIST_LIMIT,
): Promise<ClientsScreen> {
  const { data, error } = await db.rpc("clients_screen", {
    p_today: businessDate(now),
    p_limit: limit,
  });
  if (error) throw new Error(`clients_screen failed: ${error.code}`);
  const screen = clientsScreenShape.parse(data);
  return {
    total: screen.total,
    clients: screen.clients.map((row) => ({
      id: row.id,
      lastName: row.last_name,
      firstName: row.first_name,
      phone: row.phone,
      groupId: row.group_id,
      archived: row.archived,
      status: row.status,
      endsOn: row.ends_on,
    })),
    groups: screen.groups.map((group) => ({
      id: group.id,
      name: group.name,
      coachId: group.coach_id,
      archived: group.archived,
      price: group.price,
    })),
    coaches: screen.coaches,
  };
}

/** One client with group, subscription, consents, payments and the groups to choose from, or null. */
export async function getClient(
  db: Db,
  now: Date,
  clientId: string,
): Promise<ClientScreen | null> {
  const { data, error } = await db.rpc("client_screen", {
    p_client_id: clientId,
    p_today: businessDate(now),
  });
  if (error) throw new Error(`client_screen failed: ${error.code}`);
  if (data === null) return null;
  const screen = clientScreenShape.parse(data);
  const c = screen.client;
  return {
    client: {
      id: c.id,
      lastName: c.last_name,
      firstName: c.first_name,
      birthDate: c.birth_date,
      phone: c.phone,
      phoneOwner: c.phone_owner,
      parentName: c.parent_name,
      groupId: c.group_id,
      startedOn: c.started_on,
      note: c.note,
      archived: c.archived,
    },
    group: screen.group && {
      id: screen.group.id,
      name: screen.group.name,
      coachName: screen.group.coach_name,
      archived: screen.group.archived,
      price: screen.group.price,
    },
    subscription: {
      status: screen.subscription.status,
      periodStart: screen.subscription.period_start,
      endsOn: screen.subscription.ends_on,
      daysLeft: screen.subscription.days_left,
    },
    consents: screen.consents.map((consent) => ({
      kind: consent.kind,
      givenOn: consent.given_on,
      recordedBy: consent.recorded_by,
    })),
    payments: screen.payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      amount: payment.amount,
      method: payment.method,
      periodStart: payment.period_start,
      periodEnd: payment.period_end,
      reversesId: payment.reverses_id,
      reason: payment.reason,
      createdAt: payment.created_at,
      createdBy: payment.created_by,
      createdByName: payment.created_by_name,
    })),
    reminders: parseReminderEvents(screen.reminders),
    groups: screen.groups,
  };
}

/** Active groups for the new-client form: one database request. */
export async function listActiveGroups(db: Db): Promise<ActiveGroup[]> {
  const { data, error } = await db
    .from("groups")
    .select("id, name")
    .is("archived_at", null)
    .order("name");
  if (error) throw new Error(`groups failed: ${error.code}`);
  return data;
}

const isStaff = (actor: Actor) =>
  actor.role === "owner" || actor.role === "admin";

/** Postgres errors raised by the client functions, mapped to what the screen can say. */
function clientError(error: { code?: string; message?: string }): ClientError {
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0002")
    return error.message === "group_not_found"
      ? "group_not_found"
      : "not_found";
  if (error.code === "22023" && error.message === "confirmation_mismatch")
    return "confirmation_mismatch";
  // Check constraints and invalid input: the server-side Zod check should have caught these.
  if (
    error.code === "23514" ||
    error.code === "22023" ||
    error.code === "22P02"
  )
    return "invalid";
  return "unavailable";
}

/** Other clients with this phone (a shared parent's number is normal): a warning, not a refusal. */
export async function findPhoneDuplicates(
  db: Db,
  actor: Actor,
  phone: string,
  excludeId: PhoneCheckInput["excludeId"],
): Promise<Result<PhoneDuplicate[]>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("phone_duplicates", {
    p_phone: phone,
    ...(excludeId === null ? {} : { p_exclude_id: excludeId }),
  });
  if (error) return { ok: false, error: clientError(error) };
  return {
    ok: true,
    data: duplicatesShape.parse(data).map((row) => ({
      id: row.id,
      lastName: row.last_name,
      firstName: row.first_name,
      archived: row.archived,
    })),
  };
}

function clientArgs(input: ClientInput) {
  // The generated types make optional arguments non-null: leave them out for "no value".
  return {
    p_last_name: input.lastName,
    p_first_name: input.firstName,
    p_phone: input.phone,
    p_phone_owner: input.phoneOwner,
    p_started_on: input.startedOn,
    p_note: input.note,
    p_consents: input.consents,
    ...(input.birthDate === null ? {} : { p_birth_date: input.birthDate }),
    ...(input.parentName === null ? {} : { p_parent_name: input.parentName }),
    ...(input.groupId === null ? {} : { p_group_id: input.groupId }),
  };
}

/** Creates the client, its consents and the audit row together. */
export async function createClient(
  db: Db,
  actor: Actor,
  input: ClientInput,
): Promise<Result<{ id: string }>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("create_client", clientArgs(input));
  if (error) return { ok: false, error: clientError(error) };
  return { ok: true, data: { id: data } };
}

/** Saves the client; ticked consents not yet on file are added (consents are never withdrawn). */
export async function updateClient(
  db: Db,
  actor: Actor,
  clientId: string,
  input: ClientInput,
): Promise<Result<null>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { error } = await db.rpc("update_client", {
    p_client_id: clientId,
    ...clientArgs(input),
  });
  if (error) return { ok: false, error: clientError(error) };
  return { ok: true, data: null };
}

/** Archives or brings back a client; repeating it changes nothing. */
export async function setClientArchived(
  db: Db,
  actor: Actor,
  input: ArchiveClientInput,
): Promise<Result<{ changed: boolean }>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("set_client_archived", {
    p_client_id: input.clientId,
    p_archived: input.archived,
  });
  if (error) return { ok: false, error: clientError(error) };
  return { ok: true, data: { changed: data } };
}

export type DeleteOutcome = {
  /** deleted: the row is gone; anonymized: payments or consents remain, the personal data do not. */
  mode: "deleted" | "anonymized";
  reason: DeleteReason;
};

/** Owner only: deletes the client, or blanks its personal data when history rows remain. */
export async function deleteClient(
  db: Db,
  actor: Actor,
  input: DeleteClientInput,
): Promise<Result<DeleteOutcome>> {
  if (actor.role !== "owner") return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("delete_client", {
    p_client_id: input.clientId,
    p_reason: input.reason,
    p_last_name: input.lastName,
  });
  if (error) return { ok: false, error: clientError(error) };
  return {
    ok: true,
    data: {
      mode: data === "anonymized" ? "anonymized" : "deleted",
      reason: input.reason,
    },
  };
}
