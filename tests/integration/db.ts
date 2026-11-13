import postgres from "postgres";
import { inject } from "vitest";

/** Direct connection to the local Supabase Postgres started by `pnpm db:start`. */
export function connectLocalDb() {
  return postgres(inject("databaseUrl"), {
    max: 1,
    onnotice: () => undefined,
  });
}
