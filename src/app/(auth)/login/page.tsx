import type { Metadata } from "next";

import { ru } from "@/i18n/ru";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: `${ru.auth.login.title} | ${ru.app.name}`,
};

export default function LoginPage() {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ru.auth.login.title}
        </h1>
        <p className="text-muted-foreground">{ru.auth.login.subtitle}</p>
      </header>
      <LoginForm />
    </>
  );
}
