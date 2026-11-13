import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { createServerDb } from "@/db/server";

import { type Actor, STAFF_ROLES, type StaffRole } from "./roles";
import { FORBIDDEN_PATH, LOGIN_PATH } from "./routes";
import { authorizeStaff } from "./service";

// One session and role lookup per request, however many components and actions ask.
// connection() keeps it out of prefetch prerenders: access is decided at request time, so a
// deactivated employee is refused immediately (and token expiry checks read the clock).
const currentAuthorization = cache(async () => {
  await connection();
  return authorizeStaff(await createServerDb(), STAFF_ROLES);
});

/**
 * Gate for every protected page and Server Action: returns the actor or redirects (no session or
 * not active staff: sign-in page; wrong role: 403 page). The proxy checks too; this check is the
 * one that counts, because Server Actions must not rely on the proxy.
 */
export async function requireStaff(
  roles: readonly StaffRole[],
): Promise<Actor> {
  const result = await currentAuthorization();
  if (!result.ok) redirect(LOGIN_PATH);
  if (!roles.includes(result.actor.role)) redirect(FORBIDDEN_PATH);
  return result.actor;
}
