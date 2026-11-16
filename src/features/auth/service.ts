import { createHash } from "node:crypto";

import { isAuthSessionMissingError } from "@supabase/supabase-js";

import type { Db } from "@/db/client";
import { writeAuditAs } from "@/features/audit/service";

import { parseStaffAccess, type StaffAccess } from "./access";
import type { Actor, StaffRole } from "./roles";

export type AuthAction = "login";

export type Throttle =
  | { allowed: true }
  | { allowed: false; limitedBy: "email" | "ip"; retryAfterMinutes: number };

export type Authorization =
  | { ok: true; actor: Actor }
  | {
      ok: false;
      reason:
        | "unauthenticated"
        | "inactive"
        | "forbidden"
        | "password_change_required";
    };

/** Who may set their own password: any active employee, temporary password or not. */
export type PasswordChangeAuthorization =
  | { ok: true; actor: Actor; mustChangePassword: boolean }
  | { ok: false; reason: "unauthenticated" | "inactive" };

export type SignInResult =
  | { ok: true; actor: Actor; mustChangePassword: boolean }
  | {
      ok: false;
      error:
        | "invalid_credentials"
        | "rate_limited"
        | "access_disabled"
        | "unavailable";
      retryAfterMinutes?: number;
    };

export type PasswordUpdateResult =
  | { ok: true }
  | {
      ok: false;
      error:
        "same_password" | "weak_password" | "session_ended" | "unavailable";
    };

/** Supabase Auth limits per IP over a 5-minute window. */
const AUTH_SERVER_LIMIT_MINUTES = 5;

/** Throttle keys are digests, so the ledger never stores an email or an IP in readable form. */
export function throttleKey(kind: "email" | "ip", value: string): string {
  return createHash("sha256")
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

/** Checks the limits and, if allowed, counts the attempt (atomically, in Postgres). */
export async function beginAuthAttempt(
  admin: Db,
  now: Date,
  input: { action: AuthAction; email: string; ip: string },
): Promise<Throttle> {
  const { data, error } = await admin
    .rpc("auth_throttle_begin", {
      p_action: input.action,
      p_email_hash: throttleKey("email", input.email),
      p_ip_hash: throttleKey("ip", input.ip),
      p_now: now.toISOString(),
    })
    .single();
  if (error) throw new Error(`auth_throttle_begin failed: ${error.code}`);
  if (data.allowed) return { allowed: true };
  return {
    allowed: false,
    limitedBy: data.limited_by === "email" ? "email" : "ip",
    retryAfterMinutes: Math.max(1, Math.ceil(data.retry_after_seconds / 60)),
  };
}

async function recordAuthSuccess(
  admin: Db,
  now: Date,
  input: { action: AuthAction; email: string; ip: string },
): Promise<void> {
  const { error } = await admin.rpc("auth_throttle_success", {
    p_action: input.action,
    p_email_hash: throttleKey("email", input.email),
    p_ip_hash: throttleKey("ip", input.ip),
    p_now: now.toISOString(),
  });
  if (error) throw new Error(`auth_throttle_success failed: ${error.code}`);
}

/** Role and temporary-password flag of the signed-in user while they are active staff. */
async function currentStaffAccess(db: Db): Promise<StaffAccess | null> {
  const { data, error } = await db.rpc("current_staff_access");
  if (error) return null;
  return parseStaffAccess(data);
}

/** Any active employee, whether or not they still have to replace a temporary password. */
export async function authorizePasswordChange(
  db: Db,
): Promise<PasswordChangeAuthorization> {
  const { data, error } = await db.auth.getClaims();
  const userId = data?.claims.sub;
  if (error || !userId) return { ok: false, reason: "unauthenticated" };
  const access = await currentStaffAccess(db);
  if (access === null) return { ok: false, reason: "inactive" };
  return {
    ok: true,
    actor: { id: userId, role: access.role },
    mustChangePassword: access.mustChangePassword,
  };
}

/**
 * Who is calling and whether their role is one of `roles`. An employee with a temporary password
 * is refused everything until they set their own (the database refuses them as well).
 */
export async function authorizeStaff(
  db: Db,
  roles: readonly StaffRole[],
): Promise<Authorization> {
  const result = await authorizePasswordChange(db);
  if (!result.ok) return result;
  if (result.mustChangePassword)
    return { ok: false, reason: "password_change_required" };
  if (!roles.includes(result.actor.role))
    return { ok: false, reason: "forbidden" };
  return { ok: true, actor: result.actor };
}

/**
 * Password sign-in for staff. `db` receives the session (cookies in the app), `admin` is the
 * service_role client for the throttle ledger. Wrong email and wrong password look the same.
 */
export async function signIn(
  deps: { db: Db; admin: Db },
  now: Date,
  input: { email: string; password: string; ip: string },
): Promise<SignInResult> {
  const subject = {
    action: "login" as const,
    email: input.email,
    ip: input.ip,
  };
  // Fail closed: without the throttle check nobody signs in.
  const throttle = await beginAuthAttempt(deps.admin, now, subject).catch(
    () => null,
  );
  if (throttle === null) return { ok: false, error: "unavailable" };
  if (!throttle.allowed) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterMinutes: throttle.retryAfterMinutes,
    };
  }

  const { data, error } = await deps.db.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error || !data.user) {
    if (error?.status === 429) {
      return {
        ok: false,
        error: "rate_limited",
        retryAfterMinutes: AUTH_SERVER_LIMIT_MINUTES,
      };
    }
    return { ok: false, error: "invalid_credentials" };
  }

  const access = await currentStaffAccess(deps.db);
  if (access === null) {
    await deps.db.auth.signOut({ scope: "local" });
    return { ok: false, error: "access_disabled" };
  }

  const recorded = await recordAuthSuccess(deps.admin, now, subject).then(
    () => true,
    () => false,
  );
  // Every sign-in is counted and audited; if either record fails, the sign-in does not happen.
  // Written with service_role: with a temporary password the employee has no role to write it.
  const userId = data.user.id;
  if (
    !recorded ||
    !(await writeAuditAs(deps.admin, userId, "staff.login", "staff", userId))
  ) {
    await deps.db.auth.signOut({ scope: "local" });
    return { ok: false, error: "unavailable" };
  }
  return {
    ok: true,
    actor: { id: userId, role: access.role },
    mustChangePassword: access.mustChangePassword,
  };
}

/**
 * The signed-in employee sets their own password (`db` holds their session). Then the server
 * lifts the temporary-password lock, if any, and records the change as theirs with service_role:
 * while the lock is on, the employee cannot write to the database themselves.
 */
export async function updatePassword(
  deps: { db: Db; admin: Db },
  actor: Actor,
  password: string,
): Promise<PasswordUpdateResult> {
  const { error } = await deps.db.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password")
      return { ok: false, error: "same_password" };
    if (error.code === "weak_password")
      return { ok: false, error: "weak_password" };
    // The owner reset the password meanwhile, which ended every session of this employee. Auth
    // answers session_not_found; a client that has already seen that answer has no session left.
    if (error.code === "session_not_found" || isAuthSessionMissingError(error))
      return { ok: false, error: "session_ended" };
    return { ok: false, error: "unavailable" };
  }
  const { error: completeError } = await deps.admin.rpc(
    "complete_password_change",
    { p_staff_id: actor.id },
  );
  if (completeError) {
    console.error("complete_password_change failed", completeError.code);
    return { ok: false, error: "unavailable" };
  }
  return { ok: true };
}
