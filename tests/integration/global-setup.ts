import { execFileSync } from "node:child_process";

import type { TestProject } from "vitest/node";

type SupabaseStatus = Record<string, string | undefined>;

declare module "vitest" {
  export interface ProvidedContext {
    supabaseApiUrl: string;
    supabasePublishableKey: string;
    databaseUrl: string;
  }
}

function readLocalStatus(): SupabaseStatus {
  try {
    const output = execFileSync(
      "pnpm",
      ["--silent", "supabase", "status", "-o", "json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return JSON.parse(output.slice(output.indexOf("{"))) as SupabaseStatus;
  } catch {
    throw new Error(
      "Local Supabase is not running. Start it with `pnpm db:start`.",
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`supabase status did not report ${name}`);
  return value;
}

// Integration tests talk to the running local stack; take its URLs and keys from the CLI
// so no developer or CI job has to copy them into an env file.
export default function setup(project: TestProject) {
  const status = readLocalStatus();
  project.provide("supabaseApiUrl", required(status.API_URL, "API_URL"));
  project.provide(
    "supabasePublishableKey",
    required(status.PUBLISHABLE_KEY ?? status.ANON_KEY, "PUBLISHABLE_KEY"),
  );
  project.provide(
    "databaseUrl",
    process.env.DATABASE_URL ?? required(status.DB_URL, "DB_URL"),
  );
}
