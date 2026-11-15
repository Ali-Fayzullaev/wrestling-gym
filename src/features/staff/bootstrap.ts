import { z } from "zod";

// Type-only import: scripts/create-owner.ts runs this file with plain Node, which strips types
// but does not resolve the "@/" alias.
import type { Db } from "@/db/client";

export const bootstrapOwnerSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(1).max(100),
  /** Where the invitation link lands: <site>/auth/confirm. */
  redirectTo: z.url(),
});

export type BootstrapOwnerInput = z.infer<typeof bootstrapOwnerSchema>;

export type BootstrapOwnerResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      error: "already_bootstrapped" | "email_taken" | "unavailable";
    };

/**
 * Invites the first owner of a fresh database. Auth emails a link to set the password, so no
 * password ever passes through the script, the terminal or the repository. `admin` is the
 * service_role client. The database refuses once any employee exists (bootstrap_owner); the
 * check here only avoids sending an invitation that would be refused.
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

  const { data, error } = await admin.auth.admin.inviteUserByEmail(
    input.email,
    { redirectTo: input.redirectTo },
  );
  if (error || !data.user) {
    return {
      ok: false,
      error: error?.code === "email_exists" ? "email_taken" : "unavailable",
    };
  }

  const { error: rpcError } = await admin.rpc("bootstrap_owner", {
    p_id: data.user.id,
    p_full_name: input.fullName,
  });
  if (rpcError) {
    // Leave no auth user without a staff row behind: the email can be invited again later.
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
