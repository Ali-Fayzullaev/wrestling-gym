import { z } from "zod";

// All Supabase access happens on the server (Server Components, Server Actions, proxy), so the
// URL and keys are plain server variables: nothing is inlined into the browser bundle.
const publicEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const secretEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type SupabaseEnv = { url: string; publishableKey: string };

/** Read at request time so `next build` does not need the values. */
export function supabaseEnv(): SupabaseEnv {
  const env = publicEnvSchema.parse(process.env);
  return {
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  };
}

export function supabaseSecretKey(): string {
  return secretEnvSchema.parse(process.env).SUPABASE_SECRET_KEY;
}
