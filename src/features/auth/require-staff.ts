import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { createServerDb } from "@/db/server";

import type { Actor, StaffRole } from "./roles";
import { FORBIDDEN_PATH, LOGIN_PATH, PASSWORD_CHANGE_PATH } from "./routes";
import { authorizePasswordChange } from "./service";

// One session and access lookup per request, however many components and actions ask.
// connection() keeps it out of prefetch prerenders: access is decided at request time, so a
// deactivated employee is refused immediately (and token expiry checks read the clock).
const currentAccess = cache(async () => {
  await connection();
  return authorizePasswordChange(await createServerDb());
});

/**
 * Gate for every protected page and Server Action: returns the actor or redirects (no session or
 * not active staff: sign-in page; temporary password: the password form; wrong role: 403 page).
 * The proxy checks too; this check is the one that counts, because Server Actions must not rely on
 * the proxy.
 */
export async function requireStaff(
  roles: readonly StaffRole[],
): Promise<Actor> {
  const result = await currentAccess();
  if (!result.ok) redirect(LOGIN_PATH);
  if (result.mustChangePassword) redirect(PASSWORD_CHANGE_PATH);
  if (!roles.includes(result.actor.role)) redirect(FORBIDDEN_PATH);
  return result.actor;
}

/** Gate of the password form: any active employee, including one with a temporary password. */
export async function requirePasswordChange(): Promise<{
  actor: Actor;
  mustChangePassword: boolean;
}> {
  const result = await currentAccess();
  if (!result.ok) redirect(LOGIN_PATH);
  return { actor: result.actor, mustChangePassword: result.mustChangePassword };
}
