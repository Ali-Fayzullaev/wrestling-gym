"use client";

import { Send } from "lucide-react";
import { type FormEvent, useId, useState, useTransition } from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import type { StaffRole } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";
import { staffText } from "@/i18n/settings";

import {
  STAFF_NAME_MAX,
  type StaffField,
  type StaffResult,
} from "../form-fields";

const t = staffText.invite;

type Message = { tone: "ok" | "error"; text: string } | null;

export type InviteStaff = (input: {
  email: string;
  fullName: string;
  role: StaffRole;
}) => Promise<StaffResult>;

/** "Add employee": email, name and role; Supabase Auth sends the invitation email. */
export function InviteStaffForm({ invite }: { invite: InviteStaff }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("admin");
  const [invalid, setInvalid] = useState<StaffField[]>([]);
  const [emailTaken, setEmailTaken] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await invite({ email, fullName, role });
        if (result.ok) {
          setInvalid([]);
          setEmailTaken(false);
          setEmail("");
          setFullName("");
          setRole("admin");
          setMessage({ tone: "ok", text: t.sent });
          return;
        }
        setInvalid(result.fields ?? []);
        setEmailTaken(result.error === "email_taken");
        if (result.error !== "invalid" && result.error !== "email_taken") {
          setMessage({ tone: "error", text: staffText.errors[result.error] });
        }
      } catch {
        setMessage({ tone: "error", text: staffText.errors.unavailable });
      }
    });
  }

  const emailError = emailTaken
    ? t.errors.email_taken
    : invalid.includes("email")
      ? t.errors.email
      : null;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.hint}</p>
      </div>
      <TextField
        id={`${id}-email`}
        label={t.email}
        hint={t.emailHint}
        error={emailError}
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="off"
        maxLength={254}
      />
      <TextField
        id={`${id}-name`}
        label={t.fullName}
        hint={t.fullNameHint}
        error={invalid.includes("fullName") ? t.errors.fullName : null}
        value={fullName}
        onChange={setFullName}
        autoComplete="off"
        maxLength={STAFF_NAME_MAX}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-role`} className="text-sm font-medium">
          {t.role}
        </label>
        <select
          id={`${id}-role`}
          value={role}
          onChange={(event) =>
            setRole(event.target.value === "owner" ? "owner" : "admin")
          }
          aria-describedby={`${id}-role-hint`}
          className={`${inputClassName} max-w-xs`}
        >
          <option value="admin">{ru.roles.admin}</option>
          <option value="owner">{ru.roles.owner}</option>
        </select>
        <p id={`${id}-role-hint`} className="text-sm text-muted-foreground">
          {t.roleHint}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonVariants()} disabled={pending}>
          <Send aria-hidden />
          {pending ? t.pending : t.submit}
        </button>
        <p
          role="status"
          data-testid="invite-status"
          className={`text-sm ${message?.tone === "ok" ? "text-status-active-foreground" : "text-status-expired-foreground"}`}
        >
          {message?.text}
        </p>
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  hint: string;
  error: string | null;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={`${inputClassName} max-w-md`}
        {...input}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {error ? (
          <span className="text-status-expired-foreground">{error}</span>
        ) : (
          hint
        )}
      </p>
    </div>
  );
}
