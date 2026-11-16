"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import { groupFormFields, WEEK_DAYS, type WeekDay } from "../form-fields";
import type { ActionResult } from "../result";
import type { GroupField, Session } from "../schema";
import type { Coach } from "../service";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

export type GroupFormValues = {
  name: string;
  coachId: string;
  schedule: Session[];
  defaultPrice: number;
  capacity: number | null;
};

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * Create or edit a group (owner only; the Server Action checks the role again). Loaded lazily by
 * the buttons that open it. The settings screen (step 12) reuses it for "Groups and prices".
 */
export default function GroupFormDialog({
  mode,
  open,
  onOpenChange,
  coaches,
  submit,
  initial,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coaches: Coach[];
  submit: (form: FormData) => Promise<ActionResult<unknown>>;
  initial?: GroupFormValues;
}) {
  const groupsText = useText("groups");
  const f = groupsText.form;
  const commonText = useText("common");
  // A new key after a successful create gives the next "New group" an empty form.
  const [formKey, setFormKey] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = useId();

  function close(next: boolean) {
    if (pending) return;
    if (!next) setFailure(null);
    onOpenChange(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Submitted by hand, not through <form action>: React would reset the fields after the
    // action, and a failed save must keep what the owner typed.
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await submit(form);
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      toast.success(mode === "create" ? f.created : f.saved);
      onOpenChange(false);
      if (mode === "create") setFormKey((key) => key + 1);
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={close}
      title={mode === "create" ? f.createTitle : f.editTitle}
      footer={
        <>
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => close(false)}
            disabled={pending}
          >
            {commonText.cancel}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonVariants()}
            disabled={pending}
          >
            {pending ? f.saving : f.save}
          </button>
        </>
      }
    >
      <GroupFields
        key={formKey}
        id={formId}
        onSubmit={onSubmit}
        coaches={coaches}
        initial={initial}
        failure={failure}
      />
    </ResponsiveDialog>
  );
}

function GroupFields({
  id,
  onSubmit,
  coaches,
  initial,
  failure,
}: {
  id: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  coaches: Coach[];
  initial?: GroupFormValues;
  failure: Failure | null;
}) {
  const groupsText = useText("groups");
  const f = groupsText.form;
  const invalid = new Set<GroupField>(failure?.fields ?? []);
  const generalError =
    failure && (failure.error !== "invalid" || invalid.size === 0)
      ? groupsText.errors[failure.error]
      : null;
  const ids = {
    name: `${id}-name`,
    coach: `${id}-coach`,
    price: `${id}-price`,
    capacity: `${id}-capacity`,
  };
  const describedBy = (field: GroupField, hintId?: string) =>
    [hintId, invalid.has(field) ? `${id}-${field}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <form id={id} onSubmit={onSubmit} noValidate className="grid gap-5 py-1">
      {generalError ? (
        <p
          role="alert"
          className="rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
        >
          {generalError}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <label htmlFor={ids.name} className="text-sm font-medium">
          {f.name}
        </label>
        <input
          id={ids.name}
          name={groupFormFields.name}
          defaultValue={initial?.name}
          maxLength={100}
          autoComplete="off"
          required
          className={inputClassName}
          aria-invalid={invalid.has("name") || undefined}
          aria-describedby={describedBy("name", `${ids.name}-hint`)}
        />
        <Hint id={`${ids.name}-hint`}>{f.nameHint}</Hint>
        <FieldError id={`${id}-name-error`} show={invalid.has("name")}>
          {f.errors.name}
        </FieldError>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={ids.coach} className="text-sm font-medium">
          {f.coach}
        </label>
        <select
          id={ids.coach}
          name={groupFormFields.coachId}
          defaultValue={initial?.coachId ?? ""}
          required
          className={inputClassName}
          aria-invalid={invalid.has("coachId") || undefined}
          aria-describedby={describedBy("coachId")}
        >
          <option value="" disabled>
            {f.coachPlaceholder}
          </option>
          {coaches.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.name}
            </option>
          ))}
        </select>
        <FieldError id={`${id}-coachId-error`} show={invalid.has("coachId")}>
          {f.errors.coachId}
        </FieldError>
      </div>

      <ScheduleFields
        id={id}
        initial={initial?.schedule ?? []}
        invalid={invalid.has("schedule")}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <label htmlFor={ids.price} className="text-sm font-medium">
            {f.price}
          </label>
          <input
            id={ids.price}
            name={groupFormFields.defaultPrice}
            inputMode="numeric"
            autoComplete="off"
            defaultValue={initial?.defaultPrice}
            required
            className={`${inputClassName} tabular-nums`}
            aria-invalid={invalid.has("defaultPrice") || undefined}
            aria-describedby={describedBy("defaultPrice", `${ids.price}-hint`)}
          />
          <Hint id={`${ids.price}-hint`}>{f.priceHint}</Hint>
          <FieldError
            id={`${id}-defaultPrice-error`}
            show={invalid.has("defaultPrice")}
          >
            {f.errors.defaultPrice}
          </FieldError>
        </div>
        <div className="grid content-start gap-1.5">
          <label htmlFor={ids.capacity} className="text-sm font-medium">
            {f.capacity}
          </label>
          <input
            id={ids.capacity}
            name={groupFormFields.capacity}
            inputMode="numeric"
            autoComplete="off"
            defaultValue={initial?.capacity ?? ""}
            className={`${inputClassName} tabular-nums`}
            aria-invalid={invalid.has("capacity") || undefined}
            aria-describedby={describedBy("capacity", `${ids.capacity}-hint`)}
          />
          <Hint id={`${ids.capacity}-hint`}>{f.capacityHint}</Hint>
          <FieldError
            id={`${id}-capacity-error`}
            show={invalid.has("capacity")}
          >
            {f.errors.capacity}
          </FieldError>
        </div>
      </div>
    </form>
  );
}

/** A row per week day: tick the day, then its start and end time. */
function ScheduleFields({
  id,
  initial,
  invalid,
}: {
  id: string;
  initial: Session[];
  invalid: boolean;
}) {
  const groupsText = useText("groups");
  const f = groupsText.form;
  const byDay = new Map(initial.map((session) => [session.day, session]));
  const [days, setDays] = useState<ReadonlySet<number>>(
    () => new Set(byDay.keys()),
  );
  const toggle = (day: WeekDay, on: boolean) =>
    setDays((current) => {
      const next = new Set(current);
      if (on) next.add(day);
      else next.delete(day);
      return next;
    });
  const hintId = `${id}-schedule-hint`;
  const errorId = `${id}-schedule-error`;

  return (
    <fieldset
      className="grid gap-1.5"
      aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
    >
      <legend className="text-sm font-medium">{f.schedule}</legend>
      <Hint id={hintId}>{f.scheduleHint}</Hint>
      <div className="grid gap-1">
        {WEEK_DAYS.map((day) => {
          const on = days.has(day);
          const dayName = groupsText.daysLong[day - 1];
          const session = byDay.get(day);
          return (
            <div
              key={day}
              className="grid min-h-11 grid-cols-[3.75rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto_minmax(0,1fr)]"
            >
              <label className="flex min-h-11 items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name={groupFormFields.day(day)}
                  checked={on}
                  onChange={(event) => toggle(day, event.target.checked)}
                  className="size-5 shrink-0 accent-primary"
                />
                {/* "Пн" on a phone, the full name from sm up and for screen readers. */}
                <span aria-hidden className="sm:hidden">
                  {groupsText.daysShort[day - 1]}
                </span>
                <span className="sr-only sm:not-sr-only">{dayName}</span>
              </label>
              <input
                type="time"
                name={groupFormFields.start(day)}
                defaultValue={session?.start}
                disabled={!on}
                required={on}
                aria-label={`${dayName}, ${f.from}`}
                aria-invalid={(on && invalid) || undefined}
                className={`${inputClassName} tabular-nums`}
              />
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <input
                type="time"
                name={groupFormFields.end(day)}
                defaultValue={session?.end}
                disabled={!on}
                required={on}
                aria-label={`${dayName}, ${f.to}`}
                aria-invalid={(on && invalid) || undefined}
                className={`${inputClassName} tabular-nums`}
              />
            </div>
          );
        })}
      </div>
      <FieldError id={errorId} show={invalid}>
        {f.errors.schedule}
      </FieldError>
    </fieldset>
  );
}

function Hint({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function FieldError({
  id,
  show,
  children,
}: {
  id: string;
  show: boolean;
  children: string;
}) {
  if (!show) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {children}
    </p>
  );
}
