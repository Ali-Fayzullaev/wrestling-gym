import type { Metadata } from "next";

import { requirePasswordChange } from "@/features/auth/require-staff";
import { ru } from "@/i18n/ru";

import { LogoutButton } from "../../(app)/logout-button";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = {
  title: `${ru.auth.update.title} | ${ru.app.name}`,
};

/**
 * Own password of the signed-in employee. With a temporary password from the owner this is the
 * only page they can open (D-14); sign-out stays available, so a shared phone can be handed back.
 */
export default async function UpdatePasswordPage() {
  const { mustChangePassword } = await requirePasswordChange();
  const t = ru.auth.update;
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mustChangePassword ? t.requiredTitle : t.title}
        </h1>
        <p className="text-muted-foreground">
          {mustChangePassword ? t.requiredSubtitle : t.subtitle}
        </p>
      </header>
      <PasswordForm />
      <LogoutButton />
    </>
  );
}
