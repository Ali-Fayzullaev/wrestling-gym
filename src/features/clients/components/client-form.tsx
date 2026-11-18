"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { requestToaster } from "@/components/deferred-toaster";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useLocale, useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { formatDate } from "@/lib/format";
import { HTML_LANG, type Locale, LOCALE_NAMES, LOCALES } from "@/lib/locale";
import { normalizePhone } from "@/lib/phone";

import type { ParentOption } from "@/features/parents/service";

import {
  CLIENT_KINDS,
  clientFormFields as fields,
  type ClientKind,
  CONSENT_KINDS,
  type ConsentKind,
  NAME_MAX,
  NOTE_MAX,
} from "../form-fields";
import type { ActionResult } from "../result";
import type { ClientField, PhoneCheckInput } from "../schema";
import type { ActiveGroup, PhoneDuplicate } from "../service";
import { ParentPicker, type SearchParents } from "./parent-picker";

export type ClientFormValues = {
  lastName: string;
  firstName: string;
  birthDate: string | null;
  phone: string;
  kind: ClientKind;
  /** A child's parent when it is already known. */
  parent: ParentOption | null;
  groupId: string | null;
  startedOn: string;
  note: string;
  messageLocale: Locale;
};

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * New client and edit client. First the kind: an adult has their own phone and language; a child
 * has a parent (found or entered here), whose phone and language the reminders use (D-18), and
 * maybe a phone of their own. Submitted by hand, not through <form action>: React would reset the
 * fields after the action, and a failed save must keep what was typed. Leaving the phone field
 * checks the number and lists other clients with it (a warning; saving is still allowed).
 */
export function ClientForm({
  mode,
  clientId,
  initial,
  groups,
  archivedGroup,
  consentsOnFile,
  today,
  submit,
  checkPhone,
  searchParents,
}: {
  mode: "create" | "edit";
  /** The edited client: excluded from duplicates, and where Cancel returns. */
  clientId: string | null;
  initial: ClientFormValues;
  groups: ActiveGroup[];
  /** The client's current group when it is archived: it may stay, but cannot be chosen anew. */
  archivedGroup: ActiveGroup | null;
  consentsOnFile: { kind: ConsentKind; givenOn: string }[];
  today: Date;
  submit: (form: FormData) => Promise<ActionResult<{ id: string } | null>>;
  checkPhone: (
    input: PhoneCheckInput,
  ) => Promise<ActionResult<PhoneDuplicate[]>>;
  searchParents: SearchParents;
}) {
  const clientErrorText = useText("clients").errors;
  const f = useText("clientForm");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ClientKind>(initial.kind);
  const child = kind === "child";
  const [phoneWrong, setPhoneWrong] = useState(false);
  const [duplicates, setDuplicates] = useState<PhoneDuplicate[]>([]);
  // The last number looked up, so leaving the field again does not ask twice.
  const checkedPhone = useRef<string | null>(
    mode === "edit" ? normalizePhone(initial.phone) : null,
  );

  const invalid = new Set<ClientField>(failure?.fields ?? []);
  if (phoneWrong) invalid.add("phone");
  const generalError =
    failure &&
    (failure.error !== "invalid" || (failure.fields ?? []).length === 0)
      ? clientErrorText[failure.error]
      : null;
  const onFile = new Map(consentsOnFile.map((c) => [c.kind, c.givenOn]));
  const cancelHref = clientId ? `/clients/${clientId}` : "/clients";

  function onPhoneBlur(value: string) {
    if (value.trim() === "") {
      setPhoneWrong(false);
      return;
    }
    const phone = normalizePhone(value);
    setPhoneWrong(phone === null);
    if (phone === null || phone === checkedPhone.current) return;
    checkedPhone.current = phone;
    void checkPhone({ phone, excludeId: clientId }).then((result) => {
      // A newer number may have been typed meanwhile.
      if (checkedPhone.current === phone && result.ok)
        setDuplicates(result.data);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    requestToaster();
    startTransition(async () => {
      const result = await submit(form);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      // sonner is not part of this screen's first load; DeferredToaster has usually fetched it.
      const { toast } = await import("sonner");
      toast.success(mode === "create" ? f.created : f.saved);
      router.push(`/clients/${result.data?.id ?? clientId}`);
    });
  }

  const describedBy = (field: ClientField, hint = false) =>
    [
      hint ? `${id}-${field}-hint` : null,
      invalid.has(field) ? `${id}-${field}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const control = (field: ClientField, hint = false) => ({
    id: `${id}-${field}`,
    "aria-invalid": invalid.has(field) || undefined,
    "aria-describedby": describedBy(field, hint),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-2xl gap-5">
      {generalError ? (
        <p
          role="alert"
          className="rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
        >
          {generalError}
        </p>
      ) : null}

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{f.kind}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {CLIENT_KINDS.map((option) => (
            <label
              key={option}
              className="flex min-h-11 items-center gap-2.5 text-sm"
            >
              <input
                type="radio"
                name={fields.kind}
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="size-5 shrink-0 accent-primary"
              />
              {option === "adult" ? f.kindAdult : f.kindChild}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id} field="lastName" label={f.lastName} invalid={invalid}>
          <input
            {...control("lastName")}
            name={fields.lastName}
            defaultValue={initial.lastName}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
            className={inputClassName}
          />
        </Field>
        <Field id={id} field="firstName" label={f.firstName} invalid={invalid}>
          <input
            {...control("firstName")}
            name={fields.firstName}
            defaultValue={initial.firstName}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
            className={inputClassName}
          />
        </Field>
      </div>

      {child ? (
        <ParentPicker
          initial={initial.parent}
          invalid={invalid}
          search={searchParents}
        />
      ) : null}

      <Field
        id={id}
        field="phone"
        label={child ? f.childPhone : f.phone}
        hint={child ? f.childPhoneHint : f.phoneHint}
        invalid={invalid}
      >
        <input
          {...control("phone", true)}
          name={fields.phone}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={initial.phone}
          required={!child}
          onBlur={(event) => onPhoneBlur(event.target.value)}
          onChange={() => setPhoneWrong(false)}
          className={`${inputClassName} tabular-nums`}
        />
      </Field>
      {duplicates.length > 0 ? (
        <div
          role="status"
          data-testid="phone-duplicates"
          className="-mt-2 grid gap-1 rounded-md bg-status-expiring px-3 py-2 text-sm text-status-expiring-foreground"
        >
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {f.duplicates}
          </p>
          <ul className="grid gap-0.5 pl-6">
            {duplicates.map((duplicate) => (
              <li key={duplicate.id}>
                <Link
                  href={`/clients/${duplicate.id}`}
                  prefetch={false}
                  target="_blank"
                  className="underline underline-offset-4"
                >
                  {duplicate.lastName} {duplicate.firstName}
                </Link>
                {duplicate.archived ? ` (${f.duplicateArchived})` : null}
              </li>
            ))}
          </ul>
          <p>{f.duplicatesHint}</p>
        </div>
      ) : null}

      {child ? (
        // A child's reminders go in the parent's language; the client's own stays as it was.
        <input
          type="hidden"
          name={fields.messageLocale}
          value={initial.messageLocale}
        />
      ) : (
        <Field
          id={id}
          field="messageLocale"
          label={f.messageLocale}
          hint={f.messageLocaleHint}
          invalid={invalid}
        >
          <select
            {...control("messageLocale", true)}
            name={fields.messageLocale}
            defaultValue={initial.messageLocale}
            className={`${inputClassName} sm:max-w-[calc(50%-0.625rem)]`}
          >
            {LOCALES.map((option) => (
              // Each language named in itself, as the client would recognise it.
              <option key={option} value={option} lang={HTML_LANG[option]}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id} field="groupId" label={f.group} invalid={invalid}>
          <select
            {...control("groupId")}
            name={fields.groupId}
            defaultValue={initial.groupId ?? ""}
            className={inputClassName}
          >
            <option value="">{f.noGroup}</option>
            {archivedGroup ? (
              <option value={archivedGroup.id}>
                {fmt(f.archivedGroup, { name: archivedGroup.name })}
              </option>
            ) : null}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id} field="startedOn" label={f.startedOn} invalid={invalid}>
          <input
            {...control("startedOn")}
            name={fields.startedOn}
            type="date"
            defaultValue={initial.startedOn}
            required
            className={`${inputClassName} tabular-nums`}
          />
        </Field>
      </div>

      <Field
        id={id}
        field="birthDate"
        label={f.birthDate}
        hint={f.birthDateHint}
        invalid={invalid}
      >
        <input
          {...control("birthDate", true)}
          name={fields.birthDate}
          type="date"
          defaultValue={initial.birthDate ?? ""}
          className={`${inputClassName} tabular-nums sm:max-w-[calc(50%-0.625rem)]`}
        />
      </Field>

      <Field
        id={id}
        field="note"
        label={f.note}
        hint={f.noteHint}
        invalid={invalid}
      >
        <textarea
          {...control("note", true)}
          name={fields.note}
          defaultValue={initial.note}
          maxLength={NOTE_MAX}
          rows={3}
          className={`${inputClassName} h-auto min-h-24 py-2`}
        />
      </Field>

      <fieldset
        className="grid gap-1.5"
        aria-describedby={`${id}-consents-hint`}
      >
        <legend className="mb-1.5 text-sm font-medium">{f.consents}</legend>
        <p id={`${id}-consents-hint`} className="text-sm text-muted-foreground">
          {f.consentsHint}
        </p>
        {CONSENT_KINDS.map((kind) => {
          const givenOn = onFile.get(kind);
          return (
            <label
              key={kind}
              className="flex min-h-11 items-start gap-2.5 py-2 text-sm"
            >
              <input
                type="checkbox"
                name={fields.consent}
                value={kind}
                defaultChecked={givenOn !== undefined}
                disabled={givenOn !== undefined}
                className="mt-0.5 size-5 shrink-0 accent-primary"
              />
              <span>
                {f.consentKinds[kind]}
                {givenOn ? (
                  <span className="block text-muted-foreground">
                    {fmt(f.consentOnFile, {
                      date: formatDate(givenOn, today, locale),
                    })}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
        {invalid.has("consents") ? (
          <p id={`${id}-consents-error`} className="text-sm text-destructive">
            {f.errors.consents}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href={cancelHref}
          className={buttonVariants({ variant: "outline" })}
          aria-disabled={pending || undefined}
        >
          {f.cancel}
        </Link>
        <button type="submit" className={buttonVariants()} disabled={pending}>
          {pending ? f.saving : f.save}
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
  field: ClientField;
  label: string;
  hint?: string;
  invalid: ReadonlySet<ClientField>;
  children: ReactNode;
}) {
  const f = useText("clientForm");
  return (
    <div className="grid content-start gap-1.5">
      <label htmlFor={`${id}-${field}`} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-${field}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {invalid.has(field) ? (
        <p id={`${id}-${field}-error`} className="text-sm text-destructive">
          {f.errors[field as keyof typeof f.errors]}
        </p>
      ) : null}
    </div>
  );
}
