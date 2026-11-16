"use server";

import { redirect } from "next/navigation";

import { createAdminDb } from "@/db/admin";
import { createServerDb } from "@/db/server";
import { requirePasswordChange } from "@/features/auth/require-staff";
import { HOME_PATH, LOGIN_PATH } from "@/features/auth/routes";
import { newPasswordSchema } from "@/features/auth/schema";
import { updatePassword } from "@/features/auth/service";
import { getI18n } from "@/i18n/server";

export type PasswordFormState = { error: string | null };

export async function updatePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  // Open to an employee with a temporary password too: this action is how they get rid of it.
  const { actor } = await requirePasswordChange();
  const { t } = await getI18n();
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some(
      (issue) => issue.path[0] === "confirm",
    );
    return {
      error: mismatch ? t.auth.update.mismatch : t.auth.update.tooShort,
    };
  }

  const db = await createServerDb();
  const result = await updatePassword(
    { db, admin: createAdminDb() },
    actor,
    parsed.data.password,
  );
  if (!result.ok && result.error === "session_ended") {
    await db.auth.signOut({ scope: "local" });
    redirect(LOGIN_PATH);
  }
  if (!result.ok) {
    if (result.error === "same_password")
      return { error: t.auth.update.samePassword };
    if (result.error === "weak_password")
      return { error: t.auth.update.weakPassword };
    return { error: t.auth.unavailable };
  }
  redirect(HOME_PATH);
}
