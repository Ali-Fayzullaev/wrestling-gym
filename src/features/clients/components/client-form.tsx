"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { requestToaster } from "@/components/deferred-toaster";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { HTML_LANG, type Locale, LOCALE_NAMES, LOCALES } from "@/lib/locale";

import type { ParentOption } from "@/features/parents/service";

import {
  childrenFormFields,
  CLIENT_KINDS,
  clientFormFields as fields,
  type ClientKind,
  NAME_MAX,
  NOTE_MAX,
} from "../form-fields";
import type { ActionResult } from "../result";
import type { ClientField } from "../schema";
import type { ActiveGroup } from "../service";
import { ChildrenFields } from "./children-fields";
import { Field, fieldControl } from "./form-field";
import { ParentPicker, type SearchParents } from "./parent-picker";
import { type CheckPhone, PhoneDuplicates, usePhoneCheck } from "./phone-check";

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

export type SubmitChildren = (
  form: FormData,
) => Promise<ActionResult<{ parentId: string; childIds: string[] }>>;

/**
 * New client and edit client. First the kind: an adult has their own phone and language; a child
 * has a parent (found or entered here), whose phone and language the reminders use (D-18), and
 * maybe a phone of their own. Submitted by hand, not through <form action>: React would reset the
 * fields after the action, and a failed save must keep what was typed. Leaving the phone field
 * checks the number and lists other clients with it (a warning; saving is still allowed).
 *
 * A new child is saved with any brothers and sisters in one go (D-24): one parent, then a block
 * per child (ChildrenFields), sent to submitChildren. An adult and an edited child stay one client.
 */
export function ClientForm({
  mode,
  clientId,
  initial,
  groups,
  archivedGroup,
  submit,
  submitChildren,
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
  submit: (form: FormData) => Promise<ActionResult<{ id: string } | null>>;
  /** The new-client form only: several children of one parent. */
  submitChildren: SubmitChildren | null;
  checkPhone: CheckPhone;
  searchParents: SearchParents;
}) {
  const clientErrorText = useText("clients").errors;
  const f = useText("clientForm");
  const router = useRouter();
  const id = useId();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ClientKind>(initial.kind);
  const child = kind === "child";
  const severalChildren = child && submitChildren !== null;
  const phone = usePhoneCheck(
    checkPhone,
    clientId,
    mode === "edit" ? initial.phone : null,
  );
  // One key per filling of the form, made on the first save and kept for the retries, so a repeat
  // returns the children already saved instead of adding them twice.
  const requestKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const invalid = new Set<ClientField>(failure?.fields ?? []);
  if (phone.wrong) invalid.add("phone");
  const childIssues = failure?.childFields ?? [];
  const generalError =
    failure &&
    (failure.error !== "invalid" ||
      ((failure.fields ?? []).length === 0 && childIssues.length === 0))
      ? clientErrorText[failure.error]
      : null;
  const cancelHref = clientId ? `/clients/${clientId}` : "/clients";

  useEffect(() => {
    // After a failed save the first wrong field takes the focus; a general error has none.
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [failure]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    requestToaster();
    startTransition(async () => {
      let destination: string;
      let message: string;
      if (severalChildren) {
        requestKey.current ??= crypto.randomUUID();
        form.set(childrenFormFields.requestKey, requestKey.current);
        const result = await submitChildren(form);
        if (!result.ok) {
          setFailure(result);
          return;
        }
        const { parentId, childIds } = result.data;
        // One child: their card, as before. Several: the parent's card lists them all (D-19).
        destination =
          childIds.length === 1
            ? `/clients/${childIds[0]}`
            : `/parents/${parentId}`;
        message =
          childIds.length === 1
            ? f.created
            : fmt(f.childrenCreated, { count: String(childIds.length) });
      } else {
        const result = await submit(form);
        if (!result.ok) {
          setFailure(result);
          return;
        }
        destination = `/clients/${result.data?.id ?? clientId}`;
        message = mode === "create" ? f.created : f.saved;
      }
      setFailure(null);
      // sonner is not part of this screen's first load; DeferredToaster has usually fetched it.
      const { toast } = await import("sonner");
      toast.success(message);
      router.push(destination);
    });
  }

  const control = (field: ClientField, hint = false) =>
    fieldControl(id, field, invalid, hint);

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="grid max-w-2xl gap-5"
    >
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

      {severalChildren ? (
        <>
          <ParentPicker
            initial={initial.parent}
            invalid={invalid}
            search={searchParents}
          />
          <ChildrenFields
            initial={{
              lastName: initial.lastName,
              groupId: initial.groupId ?? "",
              startedOn: initial.startedOn,
            }}
            groups={groups}
            issues={childIssues}
            checkPhone={checkPhone}
            onBlocksChange={() => setFailure(null)}
          />
        </>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id={id}
              field="lastName"
              label={f.lastName}
              invalid={invalid}
            >
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
            <Field
              id={id}
              field="firstName"
              label={f.firstName}
              invalid={invalid}
            >
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
              onBlur={(event) => phone.onBlur(event.target.value)}
              onChange={phone.onChange}
              className={`${inputClassName} tabular-nums`}
            />
          </Field>
          <PhoneDuplicates duplicates={phone.duplicates} />

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
            <Field
              id={id}
              field="startedOn"
              label={f.startedOn}
              invalid={invalid}
            >
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
        </>
      )}

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
