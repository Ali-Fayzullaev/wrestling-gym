import type { Metadata } from "next";

import { requirePasswordChange } from "@/features/auth/require-staff";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { LogoutButton } from "../../(app)/logout-button";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.auth.update.title} | ${t.app.name}` };
}

/**
 * Own password of the signed-in employee. With a temporary password from the owner this is the
 * only page they can open (D-14); sign-out stays available, so a shared phone can be handed back.
 */
export default async function UpdatePasswordPage() {
  const { mustChangePassword } = await requirePasswordChange();
  const { t: messages } = await getI18n();
  const t = messages.auth.update;
  return (
    <Texts ns={["auth"]}>
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
    </Texts>
  );
}
