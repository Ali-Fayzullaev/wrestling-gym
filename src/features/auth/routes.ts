import type { StaffRole } from "./roles";

export const HOME_PATH = "/today";
export const LOGIN_PATH = "/login";
export const FORBIDDEN_PATH = "/forbidden";
export const PASSWORD_CHANGE_PATH = "/update-password";
const SIGN_OUT_PATH = "/auth/sign-out";

/** Pages reachable without a session. */
const PUBLIC_PATHS = [LOGIN_PATH, SIGN_OUT_PATH] as const;
/** Signed-in staff are sent home from these instead of seeing them again. */
const GUEST_ONLY_PATHS = [LOGIN_PATH] as const;
/** All an employee with a temporary password may open until they set their own (D-14). */
const PASSWORD_CHANGE_ONLY_PATHS = [
  PASSWORD_CHANGE_PATH,
  SIGN_OUT_PATH,
] as const;
/**
 * Money, the audit log, all settings (gym, groups and prices, reminders, staff) and the client
 * import: owner only (spec 00, roles; steps 09, 10, 12).
 */
const OWNER_PATHS = [
  "/reports",
  "/audit",
  "/settings",
  "/clients/import",
] as const;

export type RouteAccess = "public" | "staff" | "owner";

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function routeAccess(pathname: string): RouteAccess {
  if (matches(pathname, PUBLIC_PATHS)) return "public";
  if (matches(pathname, OWNER_PATHS)) return "owner";
  return "staff";
}

export type Navigation =
  | { kind: "continue" }
  | { kind: "login" }
  | { kind: "home" }
  | { kind: "change-password" }
  | { kind: "forbidden" }
  | { kind: "sign-out-and-continue" }
  | { kind: "sign-out-and-login" };

export type SessionState =
  | { signedIn: false }
  | {
      signedIn: true;
      /** Null when that user is not active staff (deactivated, or never was). */
      role: StaffRole | null;
      mustChangePassword: boolean;
    };

/**
 * What the proxy does with a request. `signedIn` means a valid session cookie; a null role ends
 * the session. An employee with a temporary password is kept on the password form.
 */
export function decideNavigation(
  pathname: string,
  session: SessionState,
): Navigation {
  const access = routeAccess(pathname);
  if (!session.signedIn) {
    return access === "public" ? { kind: "continue" } : { kind: "login" };
  }
  if (session.role === null) {
    return access === "public"
      ? { kind: "sign-out-and-continue" }
      : { kind: "sign-out-and-login" };
  }
  if (session.mustChangePassword) {
    return matches(pathname, PASSWORD_CHANGE_ONLY_PATHS)
      ? { kind: "continue" }
      : { kind: "change-password" };
  }
  if (matches(pathname, GUEST_ONLY_PATHS)) return { kind: "home" };
  if (access === "owner" && session.role !== "owner")
    return { kind: "forbidden" };
  return { kind: "continue" };
}
