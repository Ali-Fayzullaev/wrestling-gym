"use client";

import { UserPlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import {
  type ChildField,
  childFieldName,
  CHILDREN_MAX,
  NAME_MAX,
  NOTE_MAX,
} from "../form-fields";
import type { ChildFieldIssue, ClientField } from "../schema";
import type { ActiveGroup } from "../service";
import { Field, fieldControl } from "./form-field";
import { type CheckPhone, PhoneDuplicates, usePhoneCheck } from "./phone-check";

/** What a new child block starts with; the rest of its fields start empty. */
type ChildStart = { lastName: string; groupId: string; startedOn: string };
type ChildDraft = ChildStart & { key: number };

/**
 * The children of the new-client form in "Child" mode (D-24): one block per child, all saved with
 * the one parent above. Fields are named by the block's place (children.<index>.<field>), so the
 * names stay dense after a block is removed. "Add another child" copies the last name, group and
 * start date of the last block, read from the form as typed.
 */
export function ChildrenFields({
  initial,
  groups,
  issues,
  checkPhone,
  onBlocksChange,
}: {
  initial: ChildStart;
  groups: ActiveGroup[];
  /** Wrong fields from the last save, by the child's place. */
  issues: ChildFieldIssue[];
  checkPhone: CheckPhone;
  /** Places shift when a block comes or goes: the old errors no longer fit. */
  onBlocksChange: () => void;
}) {
  const f = useText("clientForm");
  const [drafts, setDrafts] = useState<ChildDraft[]>([{ ...initial, key: 0 }]);
  const nextKey = useRef(1);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Set by "Remove": the removed block took the focus with it, so it goes to "Add another child",
  // which may only appear in this render (after the tenth child it is hidden).
  const focusAddButton = useRef(false);

  useEffect(() => {
    if (!focusAddButton.current) return;
    focusAddButton.current = false;
    addButton.current?.focus();
  }, [drafts]);

  function valueOf(index: number, field: ChildField): string {
    const control = container.current?.querySelector<
      HTMLInputElement | HTMLSelectElement
    >(`[name="${childFieldName(index, field)}"]`);
    return control?.value ?? "";
  }

  function add() {
    const last = drafts.length - 1;
    const key = nextKey.current++;
    setDrafts([
      ...drafts,
      {
        key,
        lastName: valueOf(last, "lastName"),
        groupId: valueOf(last, "groupId"),
        startedOn: valueOf(last, "startedOn"),
      },
    ]);
    setFocusKey(key);
    onBlocksChange();
  }

  function remove(key: number) {
    setDrafts(drafts.filter((draft) => draft.key !== key));
    setFocusKey(null);
    focusAddButton.current = true;
    onBlocksChange();
  }

  return (
    <div ref={container} className="grid gap-4">
      {drafts.map((draft, index) => (
        <ChildBlock
          key={draft.key}
          index={index}
          start={draft}
          groups={groups}
          invalid={
            new Set<ClientField>(
              issues
                .filter((issue) => issue.index === index)
                .map((issue) => issue.field),
            )
          }
          checkPhone={checkPhone}
          focusOnMount={draft.key === focusKey}
          onRemove={index === 0 ? null : () => remove(draft.key)}
        />
      ))}
      {drafts.length < CHILDREN_MAX ? (
        <button
          ref={addButton}
          type="button"
          onClick={add}
          className={`${buttonVariants({ variant: "outline" })} sm:justify-self-start`}
        >
          <UserPlus aria-hidden />
          {f.addChild}
        </button>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {fmt(f.childrenMax, { max: String(CHILDREN_MAX) })}
        </p>
      )}
    </div>
  );
}

function ChildBlock({
  index,
  start,
  groups,
  invalid: issues,
  checkPhone,
  focusOnMount,
  onRemove,
}: {
  index: number;
  start: ChildStart;
  groups: ActiveGroup[];
  invalid: ReadonlySet<ClientField>;
  checkPhone: CheckPhone;
  focusOnMount: boolean;
  /** Null for the first child: there is always at least one. */
  onRemove: (() => void) | null;
}) {
  const f = useText("clientForm");
  const id = useId();
  const phone = usePhoneCheck(checkPhone, null, null);
  const firstName = useRef<HTMLInputElement>(null);
  // Only a block added by "Add another child" takes the focus, once, when it appears.
  const focusFirstName = useRef(focusOnMount);
  const number = String(index + 1);
  const name = (field: ChildField) => childFieldName(index, field);
  const invalid = new Set(issues);
  if (phone.wrong) invalid.add("phone");
  const control = (field: ClientField, hint = false) =>
    fieldControl(id, field, invalid, hint);

  useEffect(() => {
    if (focusFirstName.current) firstName.current?.focus();
  }, []);

  return (
    <fieldset
      aria-labelledby={`${id}-title`}
      className="grid gap-5 rounded-lg border p-4"
      data-testid="child-block"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {fmt(f.childNumber, { number })}
        </h2>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={fmt(f.removeChildLabel, { number })}
            className={buttonVariants({ variant: "ghost" })}
          >
            <X aria-hidden />
            {f.removeChild}
          </button>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id} field="lastName" label={f.lastName} invalid={invalid}>
          <input
            {...control("lastName")}
            name={name("lastName")}
            defaultValue={start.lastName}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
            className={inputClassName}
          />
        </Field>
        <Field id={id} field="firstName" label={f.firstName} invalid={invalid}>
          <input
            {...control("firstName")}
            ref={firstName}
            name={name("firstName")}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
            className={inputClassName}
          />
        </Field>
      </div>

      <Field
        id={id}
        field="phone"
        label={f.childPhone}
        hint={f.childPhoneHint}
        invalid={invalid}
      >
        <input
          {...control("phone", true)}
          name={name("phone")}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          onBlur={(event) => phone.onBlur(event.target.value)}
          onChange={phone.onChange}
          className={`${inputClassName} tabular-nums`}
        />
      </Field>
      <PhoneDuplicates duplicates={phone.duplicates} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={id} field="groupId" label={f.group} invalid={invalid}>
          <select
            {...control("groupId")}
            name={name("groupId")}
            defaultValue={start.groupId}
            className={inputClassName}
          >
            <option value="">{f.noGroup}</option>
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
            name={name("startedOn")}
            type="date"
            defaultValue={start.startedOn}
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
          name={name("birthDate")}
          type="date"
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
          name={name("note")}
          maxLength={NOTE_MAX}
          rows={2}
          className={`${inputClassName} h-auto min-h-20 py-2`}
        />
      </Field>
    </fieldset>
  );
}
