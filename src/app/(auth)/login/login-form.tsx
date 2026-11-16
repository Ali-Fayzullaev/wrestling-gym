"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { useHardNavigation } from "@/lib/use-hard-navigation";
import { ru } from "@/i18n/ru";

import { initialFormState } from "../form-state";
import { signInAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(
    signInAction,
    initialFormState,
  );
  const errorId = "login-error";
  useHardNavigation(state.redirectTo);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        id="email"
        name="email"
        type="email"
        label={ru.auth.email}
        autoComplete="username"
        inputMode="email"
        required
        defaultValue={state.email}
        key={state.email}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? errorId : undefined}
      />
      <Field
        id="password"
        name="password"
        type="password"
        label={ru.auth.password}
        autoComplete="current-password"
        required
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? errorId : undefined}
      />
      {state.error ? (
        <FormMessage id={errorId} tone="error">
          {state.error}
        </FormMessage>
      ) : null}
      <Button type="submit" size="lg" className="min-h-11" disabled={pending}>
        {pending ? ru.auth.login.pending : ru.auth.login.submit}
      </Button>
      <p className="text-sm text-muted-foreground">
        {ru.auth.login.forgotHint}
      </p>
    </form>
  );
}
