import type { TestProject } from "vitest/node";

import { readLocalSupabase } from "../support/local-supabase";

declare module "vitest" {
  export interface ProvidedContext {
    supabaseApiUrl: string;
    supabasePublishableKey: string;
    supabaseSecretKey: string;
    databaseUrl: string;
  }
}

// Integration tests talk to the running local stack.
export default function setup(project: TestProject) {
  const local = readLocalSupabase();
  project.provide("supabaseApiUrl", local.apiUrl);
  project.provide("supabasePublishableKey", local.publishableKey);
  project.provide("supabaseSecretKey", local.secretKey);
  project.provide("databaseUrl", local.databaseUrl);
}
