import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Db } from "./client";
import { supabaseEnv, supabaseSecretKey } from "./env";
import type { Database } from "./types";

/**
 * service_role client: bypasses RLS. Only for server-side tasks no employee may do directly
 * (sign-in throttling now, staff management later). Never pass it to code that renders data.
 */
export function createAdminDb(): Db {
  return createClient<Database>(supabaseEnv().url, supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
