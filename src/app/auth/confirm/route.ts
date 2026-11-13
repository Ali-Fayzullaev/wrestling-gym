import type { NextRequest } from "next/server";

import { createServerDb } from "@/db/server";
import { verifyRecoveryToken } from "@/features/auth/service";

// Target of the reset-password email: verifies the one-time token on the server (works from any
// device, unlike a PKCE code) and opens the new-password form with a fresh session.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (type === "recovery" && tokenHash) {
    const verified = await verifyRecoveryToken(
      await createServerDb(),
      tokenHash,
    );
    if (verified) return seeOther("/update-password");
  }
  return seeOther("/reset-password/expired");
}

// Relative Location: request.url carries the server's bind host (localhost), which can differ
// from the host the browser used, and the new session cookie belongs to the latter.
function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
