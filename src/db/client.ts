import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/** Supabase client typed with the generated schema; services take it as a parameter. */
export type Db = SupabaseClient<Database>;
