import { execFileSync } from "node:child_process";

export type LocalSupabase = {
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  databaseUrl: string;
  mailpitUrl: string;
};

type Status = Record<string, string | undefined>;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`supabase status did not report ${name}`);
  return value;
}

/**
 * URLs and keys of the stack started by `pnpm db:start`, read from the CLI so no developer or CI
 * job copies them into an env file. Mailpit runs on its fixed local port.
 */
export function readLocalSupabase(): LocalSupabase {
  let status: Status;
  try {
    const output = execFileSync(
      "pnpm",
      ["--silent", "supabase", "status", "-o", "json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    status = JSON.parse(output.slice(output.indexOf("{"))) as Status;
  } catch {
    throw new Error(
      "Local Supabase is not running. Start it with `pnpm db:start`.",
    );
  }
  return {
    apiUrl: required(status.API_URL, "API_URL"),
    publishableKey: required(
      status.PUBLISHABLE_KEY ?? status.ANON_KEY,
      "PUBLISHABLE_KEY",
    ),
    secretKey: required(
      status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
      "SECRET_KEY",
    ),
    databaseUrl: process.env.DATABASE_URL ?? required(status.DB_URL, "DB_URL"),
    mailpitUrl:
      status.MAILPIT_URL ?? status.INBUCKET_URL ?? "http://127.0.0.1:54324",
  };
}
