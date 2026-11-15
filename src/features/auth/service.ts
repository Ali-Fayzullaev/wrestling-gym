import { createHash } from "node:crypto";

import type { Db } from "@/db/client";
import { writeAudit } from "@/features/audit/service";

import { type Actor, isStaffRole, type StaffRole } from "./roles";

export type AuthAction = "login" | "password_reset";

export type Throttle =
  | { allowed: true }
  | { allowed: false; limitedBy: "email" | "ip"; retryAfterMinutes: number };

export type Authorization =
  | { ok: true; actor: Actor }
  | { ok: false; reason: "unauthenticated" | "inactive" | "forbidden" };

export type SignInResult =
  | { ok: true; actor: Actor }
  | {
      ok: false;
      error:
        | "invalid_credentials"
        | "rate_limited"
        | "access_disabled"
        | "unavailable";
      retryAfterMinutes?: number;
    };

export type PasswordResetResult =
  | { ok: true }
  | { ok: false; error: "rate_limited"; retryAfterMinutes: number }
  | { ok: false; error: "unavailable" };

export type PasswordUpdateResult =
  | { ok: true }
  | { ok: false; error: "same_password" | "weak_password" | "unavailable" };

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

/** Role of the signed-in user while they are active staff, otherwise null. */
async function currentStaffRole(db: Db): Promise<StaffRole | null> {
  const { data, error } = await db.rpc("current_staff_role");
  if (error) return null;
  return isStaffRole(data) ? data : null;
}

/** Who is calling and whether their role is one of `roles`. */
export async function authorizeStaff(
  db: Db,
  roles: readonly StaffRole[],
): Promise<Authorization> {
  const { data, error } = await db.auth.getClaims();
  const userId = data?.claims.sub;
  if (error || !userId) return { ok: false, reason: "unauthenticated" };
  const role = await currentStaffRole(db);
  if (role === null) return { ok: false, reason: "inactive" };
  if (!roles.includes(role)) return { ok: false, reason: "forbidden" };
  return { ok: true, actor: { id: userId, role } };
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

  const role = await currentStaffRole(deps.db);
  if (role === null) {
    await deps.db.auth.signOut({ scope: "local" });
    return { ok: false, error: "access_disabled" };
  }

  const recorded = await recordAuthSuccess(deps.admin, now, subject).then(
    () => true,
    () => false,
  );
  // Every sign-in is counted and audited; if either record fails, the sign-in does not happen.
  if (
    !recorded ||
    !(await writeAudit(deps.db, "staff.login", "staff", data.user.id))
  ) {
    await deps.db.auth.signOut({ scope: "local" });
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, actor: { id: data.user.id, role } };
}

/**
 * Sends the reset link unless limited. Hitting the per-email limit, an unknown email and an Auth
 * error all report success, so the answer never reveals whether an address belongs to staff.
 */
export async function requestPasswordReset(
  deps: { db: Db; admin: Db },
  now: Date,
  input: { email: string; ip: string; redirectTo: string },
): Promise<PasswordResetResult> {
  const throttle = await beginAuthAttempt(deps.admin, now, {
    action: "password_reset",
    email: input.email,
    ip: input.ip,
  }).catch(() => null);
  if (throttle === null) return { ok: false, error: "unavailable" };
  if (!throttle.allowed) {
    if (throttle.limitedBy === "email") return { ok: true };
    return {
      ok: false,
      error: "rate_limited",
      retryAfterMinutes: throttle.retryAfterMinutes,
    };
  }

  const { error } = await deps.db.auth.resetPasswordForEmail(input.email, {
    redirectTo: input.redirectTo,
  });
  if (error)
    console.error("password reset email failed", error.code ?? error.status);
  return { ok: true };
}

/** Sets a new password for the signed-in employee (after the reset link or later). */
export async function updatePassword(
  db: Db,
  actor: Actor,
  password: string,
): Promise<PasswordUpdateResult> {
  const { error } = await db.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password")
      return { ok: false, error: "same_password" };
    if (error.code === "weak_password")
      return { ok: false, error: "weak_password" };
    return { ok: false, error: "unavailable" };
  }
  await writeAudit(db, "staff.password_change", "staff", actor.id);
  return { ok: true };
}

/**
 * Verifies the token_hash from the reset or invitation email and starts a session for that user,
 * who then sets a password.
 */
export async function verifyEmailToken(
  db: Db,
  type: "recovery" | "invite",
  tokenHash: string,
): Promise<boolean> {
  const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
  return error === null;
}
