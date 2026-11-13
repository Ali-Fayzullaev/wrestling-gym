import type { Metadata } from "next";

import { ru } from "@/i18n/ru";

import { PasswordForm } from "./password-form";

export const metadata: Metadata = {
  title: `${ru.auth.update.title} | ${ru.app.name}`,
};

// Static page: guests are sent to sign-in by the proxy, and the action itself calls requireStaff.
export default function UpdatePasswordPage() {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ru.auth.update.title}
        </h1>
        <p className="text-muted-foreground">{ru.auth.update.subtitle}</p>
      </header>
      <PasswordForm />
    </>
  );
}
