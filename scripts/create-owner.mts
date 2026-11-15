/**
 * Invites the first owner of a fresh database (production after the first deploy).
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *     pnpm owner:create --email owner@example.kz --name "Имя Фамилия" --site https://<domain>
 *
 * The keys come from the environment, never from arguments (shell history). Auth emails a link to
 * set the password; nothing secret is printed. Refused once the database has any employee.
 */
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/db/types.ts";
import {
  bootstrapOwner,
  bootstrapOwnerSchema,
} from "../src/features/staff/bootstrap.ts";

const MESSAGES = {
  already_bootstrapped:
    "Refused: the database already has staff. Invite people from Settings in the app.",
  email_taken: "Refused: this email already has an account.",
  unavailable:
    "Failed: Supabase did not accept the request. Check the URL and key.",
} as const;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      site: { type: "string" },
    },
  });
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error(
      "Set SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.",
    );
    return 2;
  }
  const input = bootstrapOwnerSchema.safeParse({
    email: values.email,
    fullName: values.name,
    redirectTo:
      values.site && URL.canParse(values.site)
        ? new URL("/auth/confirm", values.site).href
        : "",
  });
  if (!input.success) {
    console.error(
      "Usage: --email <email> --name <full name> --site <https://domain>",
    );
    return 2;
  }

  const admin = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await bootstrapOwner(admin, input.data);
  if (!result.ok) {
    console.error(MESSAGES[result.error]);
    return 1;
  }
  console.warn(
    "Invitation sent. The owner sets a password from the email link.",
  );
  return 0;
}

process.exitCode = await main();
