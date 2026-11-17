import { randomUUID } from "node:crypto";

import { SEED_GROUP, SEED_STAFF, type Tx } from "./roles";

let phoneCounter = 9000;

/** A fictional phone outside the seed range (+7700000 0001..0150). */
export function testPhone(): string {
  phoneCounter += 1;
  return `+7700000${String(phoneCounter).padStart(4, "0")}`;
}

type ClientOverrides = Partial<{
  lastName: string;
  phone: string;
  archived: boolean;
  createdBy: string;
  messageLocale: string;
}>;

/** Inserts a client as the current role; call after `become` to exercise policies. */
export async function insertClient(
  tx: Tx,
  overrides: ClientOverrides = {},
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.clients (
      id, last_name, first_name, phone, phone_owner, group_id, started_on, archived_at, created_by,
      message_locale
    ) values (
      ${id}, ${overrides.lastName ?? "Тестовый"}, ${"Клиент"}, ${overrides.phone ?? testPhone()},
      'self', ${SEED_GROUP}, '2026-01-10',
      ${overrides.archived ? new Date("2026-01-11T00:00:00Z") : null},
      ${overrides.createdBy ?? SEED_STAFF.owner}, ${overrides.messageLocale ?? "ru"}
    )
  `;
  return id;
}

type PaymentInput = {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  amount?: number;
  createdBy?: string;
  createdAt?: Date;
  idempotencyKey?: string;
};

export async function insertPayment(
  tx: Tx,
  input: PaymentInput,
): Promise<string> {
  const id = randomUUID();
  const row = {
    id,
    client_id: input.clientId,
    kind: "payment",
    amount: input.amount ?? 15000,
    method: "cash",
    period_start: input.periodStart,
    period_end: input.periodEnd,
    idempotency_key: input.idempotencyKey ?? randomUUID(),
    created_by: input.createdBy ?? SEED_STAFF.owner,
    // Only fixtures set as postgres may backdate; staff roles have no grant on created_at.
    ...(input.createdAt ? { created_at: input.createdAt } : {}),
  };
  await tx`insert into public.payments ${tx(row)}`;
  return id;
}

type ReversalInput = {
  clientId: string;
  reversesId: string;
  periodStart: string;
  periodEnd: string;
  amount?: number;
  reason?: string | null;
  createdBy?: string;
};

export async function insertReversal(
  tx: Tx,
  input: ReversalInput,
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.payments (
      id, client_id, kind, amount, method, period_start, period_end, reverses_id, reason,
      idempotency_key, created_by
    ) values (
      ${id}, ${input.clientId}, 'reversal', ${input.amount ?? -15000}, 'cash', ${input.periodStart},
      ${input.periodEnd}, ${input.reversesId},
      ${input.reason === undefined ? "Ошибочная отметка" : input.reason}, ${randomUUID()},
      ${input.createdBy ?? SEED_STAFF.owner}
    )
  `;
  return id;
}

/** The template of a kind in a language (Russian unless said otherwise). */
export async function templateId(
  tx: Tx,
  kind: string,
  locale = "ru",
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    select id from public.message_templates where kind = ${kind} and locale = ${locale}
  `;
  if (!row) throw new Error(`no template of kind ${kind} in ${locale}`);
  return row.id;
}
