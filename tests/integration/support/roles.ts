import type postgres from "postgres";

export type Tx = postgres.TransactionSql;

/** Staff created by supabase/seed.sql. */
export const SEED_STAFF = {
  owner: "00000000-0000-4000-8000-000000000001",
  admin: "00000000-0000-4000-8000-000000000002",
  otherAdmin: "00000000-0000-4000-8000-000000000003",
} as const;

export const SEED_GROUP = "10000000-0000-4000-8000-000000000001";

/**
 * Who runs the next statements: a database role without a user (anon, service_role), the
 * migration owner (postgres, for fixtures) or a signed-in user identified by auth.users id.
 */
export type Actor = "anon" | "service_role" | "postgres" | { userId: string };

export const owner: Actor = { userId: SEED_STAFF.owner };
export const admin: Actor = { userId: SEED_STAFF.admin };
export const otherAdmin: Actor = { userId: SEED_STAFF.otherAdmin };

/** Switches role and JWT claims for the rest of the transaction, like PostgREST does per request. */
export async function become(tx: Tx, actor: Actor): Promise<void> {
  await tx`reset role`;
  if (actor === "postgres") {
    await tx`select set_config('request.jwt.claims', '', true)`;
    return;
  }
  const role = typeof actor === "string" ? actor : "authenticated";
  const claims =
    typeof actor === "string" ? { role } : { sub: actor.userId, role };
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await tx.unsafe(`set local role ${role}`);
}

class Rollback extends Error {}

/** Runs fn in a transaction that is always rolled back, so tests leave the seed data intact. */
export async function rolledBack<T>(
  sql: postgres.Sql,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const box: { value?: T } = {};
  try {
    await sql.begin(async (tx) => {
      box.value = await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return box.value as T;
}

/** Rolled-back transaction acting as `actor` from the first statement. */
export function asActor<T>(
  sql: postgres.Sql,
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return rolledBack(sql, async (tx) => {
    await become(tx, actor);
    return fn(tx);
  });
}
