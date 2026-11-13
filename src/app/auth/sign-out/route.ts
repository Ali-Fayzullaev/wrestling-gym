import type { NextRequest } from "next/server";

import { createServerDb } from "@/db/server";
import { LOGIN_PATH } from "@/features/auth/routes";

// Target of the plain HTML "Sign out" form (no client JS on every screen). The browser follows the
// 303 with a full page load, so nothing of this session stays in the router's memory on a shared
// phone. Global scope also revokes the refresh token, so a copied cookie stops working too.
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return new Response(null, { status: 403 });
  }
  const db = await createServerDb();
  await db.auth.signOut();
  // Relative Location: request.url carries the server's bind host (see /auth/confirm).
  return new Response(null, {
    status: 303,
    headers: { location: LOGIN_PATH, "cache-control": "no-store" },
  });
}

/**
 * A plain form has no Server Action origin check, so do it here: another site must not be able to
 * end a session. The session cookie is SameSite=Lax as well, so a cross-site POST carries none.
 */
function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  return origin !== null && host !== null && new URL(origin).host === host;
}
