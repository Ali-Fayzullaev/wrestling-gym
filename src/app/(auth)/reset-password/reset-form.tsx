"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { ru } from "@/i18n/ru";

import { initialFormState } from "../form-state";
import { requestPasswordResetAction } from "./actions";

export function ResetForm({ linkInvalid }: { linkInvalid: boolean }) {
  const [state, action, pending] = useActionState(
    requestPasswordResetAction,
    initialFormState,
  );
  const messageId = "reset-message";
  const error =
    state.error ??
    (linkInvalid && !state.notice ? ru.auth.reset.linkInvalid : null);

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
        aria-describedby={error || state.notice ? messageId : undefined}
      />
      {error ? (
        <FormMessage id={messageId} tone="error">
          {error}
        </FormMessage>
      ) : null}
      {state.notice ? (
        <FormMessage id={messageId} tone="info">
          {state.notice}
        </FormMessage>
      ) : null}
      <Button type="submit" size="lg" className="min-h-11" disabled={pending}>
        {pending ? ru.auth.reset.pending : ru.auth.reset.submit}
      </Button>
    </form>
  );
}
