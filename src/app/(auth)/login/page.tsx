import type { Metadata } from "next";

import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.auth.login.title} | ${t.app.name}` };
}

export default async function LoginPage() {
  const { t } = await getI18n();
  return (
    <Texts ns={["auth"]}>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t.auth.login.title}
        </h1>
        <p className="text-muted-foreground">{t.auth.login.subtitle}</p>
      </header>
      <LoginForm />
    </Texts>
  );
}
