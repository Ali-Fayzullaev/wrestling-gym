import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { Db } from "@/db/client";
import type { Database } from "@/db/types";

/** Seeded local accounts (supabase/seed.sql); the password is for local stacks only. */
export const SEED_PASSWORD = "local-dev-only";
export const SEED_EMAILS = {
  owner: "owner@example.test",
  admin: "admin1@example.test",
  otherAdmin: "admin2@example.test",
} as const;

type Connection = { apiUrl: string; publishableKey: string; secretKey: string };

/** A client with its own in-memory session, like one browser. */
export function anonClient(connection: Connection): Db {
  return createClient<Database>(connection.apiUrl, connection.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(connection: Connection): Db {
  return createClient<Database>(connection.apiUrl, connection.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TempStaff = { id: string; email: string; password: string };

/**
 * Creates a throwaway employee for tests that change an account (deactivation, password reset)
 * so shared seed accounts stay usable by parallel tests. Staff rows cannot be deleted (audit rows
 * point at them), so these stay in the local database until `pnpm db:reset`.
 */
export async function createTempStaff(
  connection: Connection,
  role: "owner" | "admin",
): Promise<TempStaff> {
  const service = serviceClient(connection);
  const email = `test-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
  const { error: staffError } = await service
    .from("staff")
    .insert({ id: data.user.id, full_name: "Тестовый сотрудник", role });
  if (staffError) throw new Error(`staff insert failed: ${staffError.code}`);
  return { id: data.user.id, email, password };
}

export async function setStaffActive(
  connection: Connection,
  staffId: string,
  active: boolean,
): Promise<void> {
  const { error } = await serviceClient(connection)
    .from("staff")
    .update({ active })
    .eq("id", staffId);
  if (error) throw new Error(`staff update failed: ${error.code}`);
}
