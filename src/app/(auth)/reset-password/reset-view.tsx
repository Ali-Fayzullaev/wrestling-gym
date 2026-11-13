import { ru } from "@/i18n/ru";

import { ResetForm } from "./reset-form";

/** Static on purpose: forms on fully prerendered pages also work when sent before hydration. */
export function ResetPasswordView({ linkInvalid }: { linkInvalid: boolean }) {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ru.auth.reset.title}
        </h1>
        <p className="text-muted-foreground">{ru.auth.reset.subtitle}</p>
      </header>
      <ResetForm linkInvalid={linkInvalid} />
      <a
        href="/login"
        className="inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4"
      >
        {ru.auth.reset.backToLogin}
      </a>
    </>
  );
}
