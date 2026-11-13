"use server";

import { redirect } from "next/navigation";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { HOME_PATH } from "@/features/auth/routes";
import { newPasswordSchema } from "@/features/auth/schema";
import { updatePassword } from "@/features/auth/service";
import { ru } from "@/i18n/ru";

export type PasswordFormState = { error: string | null };

export async function updatePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some(
      (issue) => issue.path[0] === "confirm",
    );
    return {
      error: mismatch ? ru.auth.update.mismatch : ru.auth.update.tooShort,
    };
  }

  const result = await updatePassword(
    await createServerDb(),
    actor,
    parsed.data.password,
  );
  if (!result.ok) {
    if (result.error === "same_password")
      return { error: ru.auth.update.samePassword };
    if (result.error === "weak_password")
      return { error: ru.auth.update.weakPassword };
    return { error: ru.auth.unavailable };
  }
  redirect(HOME_PATH);
}
