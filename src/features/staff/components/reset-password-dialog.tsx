"use client";

import { type FormEvent, useId, useState } from "react";

import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import { TextField } from "./text-field";

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
  const staffText = useText("staff");
  const t = staffText.reset;
  const commonText = useText("common");
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
      title={fmt(t.title, { name: fullName })}
      description={t.text}
    >
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        aria-label={fmt(t.title, { name: fullName })}
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
            {commonText.cancel}
          </button>
          <button type="submit" className={buttonVariants()} disabled={pending}>
            {pending ? t.pending : t.submit}
          </button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
