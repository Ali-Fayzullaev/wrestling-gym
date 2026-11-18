import { randomInt, randomUUID } from "node:crypto";

import { insertPayment } from "./fixtures";
import { SEED_GROUP, SEED_STAFF, type Tx } from "./roles";

/** Phones outside the seed (+7700000…, +7700002…) and outside testPhone() (+77000009…). */
export const familyPhone = () =>
  `+7703${String(randomInt(1e7)).padStart(7, "0")}`;

export async function insertParent(
  tx: Tx,
  row: {
    name?: string;
    phone?: string;
    locale?: string;
    archived?: boolean;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.parents (id, name, phone, message_locale, archived_at, created_by)
    values (
      ${id}, ${row.name ?? "Айгуль"}, ${row.phone ?? familyPhone()}, ${row.locale ?? "ru"},
      ${row.archived ? new Date("2026-01-01T00:00:00Z") : null}, ${SEED_STAFF.owner}
    )
  `;
  return id;
}

export async function insertChild(
  tx: Tx,
  parentId: string,
  firstName: string,
): Promise<string> {
  const id = randomUUID();
  await tx`
    insert into public.clients (
      id, last_name, first_name, phone, parent_id, group_id, started_on, created_by
    ) values (
      ${id}, 'Семейный', ${firstName}, null, ${parentId}, ${SEED_GROUP}, '2026-01-10',
      ${SEED_STAFF.owner}
    )
  `;
  return id;
}

/** A paid subscription ending on `periodEnd`, recorded long ago. */
export function paidUntil(tx: Tx, clientId: string, periodEnd: string) {
  return insertPayment(tx, {
    clientId,
    periodStart: "2026-02-16",
    periodEnd,
    createdAt: new Date("2026-02-16T06:00:00Z"),
  });
}
