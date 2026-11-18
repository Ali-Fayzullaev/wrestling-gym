"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useState,
  useTransition,
} from "react";

import { requestToaster } from "@/components/deferred-toaster";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { HTML_LANG, type Locale, LOCALE_NAMES, LOCALES } from "@/lib/locale";

import {
  PARENT_NAME_MAX,
  PARENT_NOTE_MAX,
  parentFormFields as fields,
} from "../form-fields";
import type { ParentField } from "../schema";
import type { ParentError } from "../service";

export type ParentFormValues = {
  name: string;
  phone: string;
  messageLocale: Locale;
  note: string;
};

export type SaveParent = (
  form: FormData,
) => Promise<
  { ok: true } | { ok: false; error: ParentError; fields?: ParentField[] }
>;

/**
 * Name, phone, message language and note of a parent. The phone and language are what every
 * child's reminder uses (D-18). Submitted by hand so a failed save keeps what was typed.
 */
export function ParentForm({
  parentId,
  initial,
  submit,
}: {
  parentId: string;
  initial: ParentFormValues;
  submit: SaveParent;
}) {
  const t = useText("parents");
  const id = useId();
  const router = useRouter();
  const [invalid, setInvalid] = useState<ReadonlySet<ParentField>>(new Set());
  const [error, setError] = useState<ParentError | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    requestToaster();
    startTransition(async () => {
      const result = await submit(form);
      if (!result.ok) {
        setInvalid(new Set(result.fields ?? []));
        setError(
          result.error === "invalid" && (result.fields ?? []).length > 0
            ? null
            : result.error,
        );
        return;
      }
      const { toast } = await import("sonner");
      toast.success(t.saved);
      router.push(`/parents/${parentId}`);
    });
  }

  const control = (field: ParentField, hint = false) => ({
    id: `${id}-${field}`,
    "aria-invalid": invalid.has(field) || undefined,
    "aria-describedby":
      [
        hint ? `${id}-${field}-hint` : null,
        invalid.has(field) ? `${id}-${field}-error` : null,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-2xl gap-5">
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
        >
          {t.errors[error]}
        </p>
      ) : null}
      <Field
        id={id}
        field="name"
        label={t.name}
        hint={t.nameHint}
        invalid={invalid}
      >
        <input
          {...control("name", true)}
          name={fields.name}
          defaultValue={initial.name}
          maxLength={PARENT_NAME_MAX}
          autoComplete="off"
          required
          className={inputClassName}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id={id}
          field="phone"
          label={t.phone}
          hint={t.phoneHint}
          invalid={invalid}
        >
          <input
            {...control("phone", true)}
            name={fields.phone}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            defaultValue={initial.phone}
            required
            className={`${inputClassName} tabular-nums`}
          />
        </Field>
        <Field
          id={id}
          field="messageLocale"
          label={t.messageLocale}
          hint={t.messageLocaleHint}
          invalid={invalid}
        >
          <select
            {...control("messageLocale", true)}
            name={fields.messageLocale}
            defaultValue={initial.messageLocale}
            className={inputClassName}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option} lang={HTML_LANG[option]}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        id={id}
        field="note"
        label={t.note}
        hint={t.noteHint}
        invalid={invalid}
      >
        <textarea
          {...control("note", true)}
          name={fields.note}
          defaultValue={initial.note}
          maxLength={PARENT_NOTE_MAX}
          rows={3}
          className={`${inputClassName} h-auto min-h-24 py-2`}
        />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href={`/parents/${parentId}`}
          className={buttonVariants({ variant: "outline" })}
          aria-disabled={pending || undefined}
        >
          {t.cancel}
        </Link>
        <button type="submit" className={buttonVariants()} disabled={pending}>
          {pending ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  field,
  label,
  hint,
  invalid,
  children,
}: {
  id: string;
  field: ParentField;
  label: string;
  hint: string;
  invalid: ReadonlySet<ParentField>;
  children: ReactNode;
}) {
  const t = useText("parents");
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={`${id}-${field}`} className="text-sm font-medium">
        {label}
      </label>
      {children}
      <p id={`${id}-${field}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
      {invalid.has(field) ? (
        <p id={`${id}-${field}-error`} className="text-sm text-destructive">
          {t.fieldErrors[field]}
        </p>
      ) : null}
    </div>
  );
}
