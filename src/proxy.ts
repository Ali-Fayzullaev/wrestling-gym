import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { sessionCookieOptions } from "@/db/cookie-options";
import { supabaseEnv } from "@/db/env";
import type { Database } from "@/db/types";
import { isStaffRole, type StaffRole } from "@/features/auth/roles";
import {
  decideNavigation,
  FORBIDDEN_PATH,
  HOME_PATH,
  LOGIN_PATH,
} from "@/features/auth/routes";
import {
  contentSecurityPolicy,
  createNonce,
  sha256Source,
  STATIC_SECURITY_HEADERS,
} from "@/lib/security-headers";
import { themeInitScript } from "@/lib/theme";

// Next 16 renamed middleware.ts to proxy.ts. Runs before every page and Server Action request:
// refreshes the session cookie, ends the session of deactivated staff on the very next request,
// sends guests to sign-in and answers 403 on owner-only pages. It also sets the security headers.
export async function proxy(request: NextRequest) {
  const csp = await requestPolicy(request);
  // Next.js reads the nonce from the request's CSP and puts it on its own scripts.
  request.headers.set("content-security-policy", csp);
  const response = await navigate(request);
  response.headers.set("content-security-policy", csp);
  for (const { key, value } of STATIC_SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

// The theme script in the root layout is the same on every request: allowed by its hash, so the
// layout does not have to read the nonce.
const themeScriptSource = sha256Source(themeInitScript);

async function requestPolicy(request: NextRequest): Promise<string> {
  const themeScript = await themeScriptSource;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  return contentSecurityPolicy({
    nonce: createNonce(),
    scriptHashes: [themeScript],
    isDev: process.env.NODE_ENV === "development",
    isHttps: proto === "https",
  });
}

async function navigate(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = supabaseEnv();
  const db = createServerClient<Database>(url, publishableKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  const { data } = await db.auth.getClaims();
  const signedIn = Boolean(data?.claims.sub);
  let role: StaffRole | null = null;
  if (signedIn) {
    const { data: staffRole } = await db.rpc("current_staff_role");
    role = isStaffRole(staffRole) ? staffRole : null;
  }

  const { pathname, search } = request.nextUrl;
  const navigation = decideNavigation(
    pathname,
    signedIn ? { signedIn: true, role } : { signedIn: false },
  );

  switch (navigation.kind) {
    case "continue":
      // Pages of a signed-in employee are personal: no browser or shared cache may keep them,
      // or the next person on the same device could be shown the previous one's menu and data.
      if (signedIn) response.headers.set("cache-control", "private, no-store");
      return response;
    case "sign-out-and-continue":
      await db.auth.signOut({ scope: "local" });
      return response;
    case "sign-out-and-login":
      await db.auth.signOut({ scope: "local" });
      return carryCookies(response, NextResponse.redirect(loginUrl(request)));
    case "login":
      return carryCookies(
        response,
        NextResponse.redirect(loginUrl(request, `${pathname}${search}`)),
      );
    case "home":
      return carryCookies(
        response,
        NextResponse.redirect(new URL(HOME_PATH, request.url)),
      );
    case "forbidden":
      return carryCookies(
        response,
        NextResponse.rewrite(new URL(FORBIDDEN_PATH, request.url), {
          status: 403,
        }),
      );
  }
}

function loginUrl(request: NextRequest, next?: string): URL {
  const url = new URL(LOGIN_PATH, request.url);
  if (next) url.searchParams.set("next", next);
  return url;
}

/** A refreshed or cleared session cookie must survive a redirect or rewrite. */
function carryCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  const cacheControl = from.headers.get("cache-control");
  if (cacheControl) to.headers.set("cache-control", cacheControl);
  return to;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
