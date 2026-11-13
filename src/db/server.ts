import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Db } from "./client";
import { sessionCookieOptions } from "./cookie-options";
import { supabaseEnv } from "./env";
import type { Database } from "./types";

/** Supabase client acting as the signed-in employee (session from cookies, RLS applies). */
export async function createServerDb(): Promise<Db> {
  const store = await cookies();
  const { url, publishableKey } = supabaseEnv();
  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
