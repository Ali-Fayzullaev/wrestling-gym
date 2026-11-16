"use client";

import { type FormEvent, useId, useState } from "react";

import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { ru } from "@/i18n/ru";
import { staffText } from "@/i18n/settings";

import { TextField } from "./text-field";

const t = staffText.reset;

/**
 * Asks the owner for a new temporary password for one employee; loaded on first intent, not with
 * the staff screen. The field clears when the dialog closes, so the password does not linger.
 */
export default function ResetPasswordDialog({
  fullName,
  open,
  pending,
  invalid,
  onOpenChange,
  onSubmit,
}: {
  fullName: string;
  open: boolean;
  pending: boolean;
  /** Set when the server refused the password (length or too easy). */
  invalid: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (password: string) => Promise<boolean>;
}) {
  const id = useId();
  const [password, setPassword] = useState("");

  function close(next: boolean) {
    if (pending) return;
    if (!next) setPassword("");
    onOpenChange(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(password).then((done) => {
      if (done) setPassword("");
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={t.title(fullName)}
      description={t.text}
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        aria-label={t.title(fullName)}
      >
        <TextField
          id={`${id}-password`}
          label={t.password}
          hint={t.passwordHint}
          error={invalid}
          value={password}
          onChange={setPassword}
          // Visible on purpose: the owner reads it out or writes it down for the employee.
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={72}
        />
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => close(false)}
            disabled={pending}
          >
            {ru.common.cancel}
          </button>
          <button type="submit" className={buttonVariants()} disabled={pending}>
            {pending ? t.pending : t.submit}
          </button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
