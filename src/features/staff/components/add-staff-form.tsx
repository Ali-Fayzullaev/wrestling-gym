"use client";

import { UserPlus } from "lucide-react";
import { type FormEvent, useId, useState, useTransition } from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import type { StaffRole } from "@/features/auth/roles";
import { useText } from "@/i18n/client";

import {
  STAFF_NAME_MAX,
  type StaffField,
  type StaffResult,
} from "../form-fields";
import { TextField } from "./text-field";

type Message = { tone: "ok" | "error"; text: string } | null;

export type AddStaff = (input: {
  email: string;
  fullName: string;
  role: StaffRole;
  password: string;
}) => Promise<StaffResult>;

/**
 * "Add employee": email, name, role and a temporary password the owner hands over in person
 * (D-14, no email). The employee replaces it with their own at the first sign-in.
 */
export function AddStaffForm({ add }: { add: AddStaff }) {
  const staffText = useText("staff");
  const t = staffText.add;
  const rolesText = useText("roles");
  const id = useId();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("admin");
  const [password, setPassword] = useState("");
  const [invalid, setInvalid] = useState<StaffField[]>([]);
  const [emailTaken, setEmailTaken] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await add({ email, fullName, role, password });
        if (result.ok) {
          setInvalid([]);
          setEmailTaken(false);
          setEmail("");
          setFullName("");
          setRole("admin");
          setPassword("");
          setMessage({ tone: "ok", text: t.added });
          return;
        }
        setInvalid(result.fields ?? []);
        setEmailTaken(result.error === "email_taken");
        if (result.error === "weak_password") {
          setInvalid(["password"]);
          setMessage({ tone: "error", text: staffText.errors.weak_password });
          return;
        }
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
          <option value="admin">{rolesText.admin}</option>
          <option value="owner">{rolesText.owner}</option>
        </select>
        <p id={`${id}-role-hint`} className="text-sm text-muted-foreground">
          {t.roleHint}
        </p>
      </div>
      <TextField
        id={`${id}-password`}
        label={t.password}
        hint={t.passwordHint}
        error={invalid.includes("password") ? t.errors.password : null}
        value={password}
        onChange={setPassword}
        // Visible on purpose: the owner reads it out or writes it down for the employee.
        type="text"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={72}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonVariants()} disabled={pending}>
          <UserPlus aria-hidden />
          {pending ? t.pending : t.submit}
        </button>
        <p
          role="status"
          data-testid="add-staff-status"
          className={`text-sm ${message?.tone === "ok" ? "text-status-active-foreground" : "text-status-expired-foreground"}`}
        >
          {message?.text}
        </p>
      </div>
    </form>
  );
}
