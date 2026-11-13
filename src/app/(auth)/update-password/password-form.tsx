"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { ru } from "@/i18n/ru";

import { type PasswordFormState, updatePasswordAction } from "./actions";

const initialState: PasswordFormState = { error: null };

export function PasswordForm() {
  const [state, action, pending] = useActionState(
    updatePasswordAction,
    initialState,
  );
  const errorId = "password-error";
  const described = state.error ? errorId : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        id="password"
        name="password"
        type="password"
        label={ru.auth.update.password}
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
        required
        aria-invalid={state.error ? true : undefined}
        aria-describedby={described}
      />
      <Field
        id="confirm"
        name="confirm"
        type="password"
        label={ru.auth.update.confirm}
        autoComplete="new-password"
        maxLength={72}
        required
        aria-invalid={state.error ? true : undefined}
        aria-describedby={described}
      />
      {state.error ? (
        <FormMessage id={errorId} tone="error">
          {state.error}
        </FormMessage>
      ) : null}
      <Button type="submit" size="lg" className="min-h-11" disabled={pending}>
        {pending ? ru.auth.update.pending : ru.auth.update.submit}
      </Button>
    </form>
  );
}
