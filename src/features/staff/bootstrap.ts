import { z } from "zod";

// Type-only import: scripts/create-owner.ts runs this file with plain Node, which strips types
// but does not resolve the "@/" alias.
import type { Db } from "@/db/client";

/** bcrypt, which Supabase Auth hashes passwords with, ignores everything past 72 bytes. */
const MAX_PASSWORD_BYTES = 72;

export const bootstrapOwnerSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(1).max(100),
  // Not trimmed: the owner signs in with exactly what they typed.
  password: z
    .string()
    .min(8)
    .refine(
      (value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES,
    ),
});

export type BootstrapOwnerInput = z.infer<typeof bootstrapOwnerSchema>;

export type BootstrapOwnerResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      error:
        | "already_bootstrapped"
        | "email_taken"
        | "weak_password"
        | "unavailable";
    };

/**
 * Creates the first owner of a fresh database with a password, without email (D-14: the gym
 * works without SMTP). `admin` is the service_role client. The database refuses once any employee
 * exists (bootstrap_owner); the check here only avoids creating an account that would be refused.
 */
export async function bootstrapOwner(
  admin: Db,
  input: BootstrapOwnerInput,
): Promise<BootstrapOwnerResult> {
  const { count, error: countError } = await admin
    .from("staff")
    .select("id", { count: "exact", head: true });
  if (countError) return { ok: false, error: "unavailable" };
  if ((count ?? 0) > 0) return { ok: false, error: "already_bootstrapped" };

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    // Nobody can click a confirmation link without email; the owner proves who they are by
    // running this script with the server key.
    email_confirm: true,
  });
  if (error || !data.user) {
    return { ok: false, error: createUserError(error?.code) };
  }

  const { error: rpcError } = await admin.rpc("bootstrap_owner", {
    p_id: data.user.id,
    p_full_name: input.fullName,
  });
  if (rpcError) {
    // Leave no auth user without a staff row behind: the script can be run again.
    await admin.auth.admin.deleteUser(data.user.id);
    return {
      ok: false,
      error:
        rpcError.message === "already_bootstrapped"
          ? "already_bootstrapped"
          : "unavailable",
    };
  }
  return { ok: true, userId: data.user.id };
}

function createUserError(
  code: string | undefined,
): "email_taken" | "weak_password" | "unavailable" {
  if (code === "email_exists") return "email_taken";
  if (code === "weak_password") return "weak_password";
  return "unavailable";
}
