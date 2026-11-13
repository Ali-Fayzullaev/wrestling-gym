import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Session cookies are never read by browser code (there is no browser Supabase client), so they
 * are httpOnly. `secure` is on wherever the app runs as a production build.
 */
export function sessionCookieOptions(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CookieOptionsWithName {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: nodeEnv === "production",
  };
}
