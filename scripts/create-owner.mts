/**
 * Creates the first owner of a fresh database (production after the first deploy), with a
 * password and without email (D-14).
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
 *     pnpm owner:create --email owner@example.kz --name "Имя Фамилия"
 *
 * In a terminal it asks for the password twice without echoing it. Otherwise it reads the
 * password from standard input (`< file`). Keys and password never come from arguments, so they
 * stay out of shell history and the process list; nothing secret is printed. Refused once the
 * database has any employee.
 */
import { stdin, stderr } from "node:process";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/db/types.ts";
import {
  bootstrapOwner,
  bootstrapOwnerSchema,
} from "../src/features/staff/bootstrap.ts";

const MESSAGES = {
  already_bootstrapped:
    "Refused: the database already has staff. Add people from Settings in the app.",
  email_taken: "Refused: this email already has an account.",
  weak_password: "Refused: Supabase considers the password too weak.",
  unavailable:
    "Failed: Supabase did not accept the request. Check the URL and key.",
} as const;

const USAGE =
  "Usage: --email <email> --name <full name>; password: typed twice, or on stdin (8 to 72 bytes).";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
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

  const password = stdin.isTTY ? await promptTwice() : await readStdin();
  if (password === null) {
    console.error("The two passwords differ. Nothing was created.");
    return 2;
  }
  const input = bootstrapOwnerSchema.safeParse({
    email: values.email,
    fullName: values.name,
    password,
  });
  if (!input.success) {
    console.error(USAGE);
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
    "Owner created. Sign in with this email and password, then change it at /update-password if someone else chose it.",
  );
  return 0;
}

/** The first line of standard input, without the line break a file or `echo` adds. */
async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of stdin) text += String(chunk);
  return text.split(/\r?\n/, 1)[0] ?? "";
}

/** Returns the password, or null when the confirmation does not match. */
async function promptTwice(): Promise<string | null> {
  const first = await promptHidden("Password: ");
  const second = await promptHidden("Repeat password: ");
  return first === second ? first : null;
}

function promptHidden(question: string): Promise<string> {
  stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (key: string) => {
      for (const char of key) {
        if (char === "\r" || char === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") process.exit(130);
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

process.exitCode = await main();
