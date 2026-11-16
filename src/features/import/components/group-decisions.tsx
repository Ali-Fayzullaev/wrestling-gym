"use client";

import { inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import { GROUP_PRICE_MAX } from "../limits";
import type { Option } from "../result";

/** What the owner chose for one unknown group; price stays text while it is being typed. */
export type GroupDraft =
  | { kind: "create"; coachId: string; price: string }
  | { kind: "none" }
  | { kind: "existing"; groupId: string };

export const NEW_GROUP_DRAFT: GroupDraft = {
  kind: "create",
  coachId: "",
  price: "",
};

export function parsePrice(text: string): number | null {
  if (!/^\d{1,8}$/.test(text.trim())) return null;
  const price = Number(text.trim());
  return price >= 1 && price <= GROUP_PRICE_MAX ? price : null;
}

export function isDraftComplete(draft: GroupDraft): boolean {
  return (
    draft.kind !== "create" ||
    (draft.coachId !== "" && parsePrice(draft.price) !== null)
  );
}

function choiceValue(draft: GroupDraft): string {
  if (draft.kind === "existing") return `existing:${draft.groupId}`;
  return draft.kind;
}

/** For each group name the file has but the gym does not: create it, use another or none. */
export function GroupDecisions({
  names,
  drafts,
  groups,
  coaches,
  disabled,
  onChange,
}: {
  names: readonly { key: string; name: string }[];
  drafts: Readonly<Record<string, GroupDraft>>;
  groups: readonly Option[];
  coaches: readonly Option[];
  disabled: boolean;
  onChange: (key: string, draft: GroupDraft) => void;
}) {
  const t = useText("import").groups;
  return (
    <section
      aria-labelledby="import-groups"
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="import-groups" className="text-base font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.hint}</p>
      </div>
      <ul className="flex flex-col gap-5">
        {names.map(({ key, name }, index) => {
          const draft = drafts[key] ?? NEW_GROUP_DRAFT;
          const id = `import-group-${index}`;
          return (
            <li
              key={key}
              className="flex flex-col gap-3"
              data-testid="import-group"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-sm font-medium">
                  {fmt(t.choice, { name })}
                </label>
                <select
                  id={id}
                  value={choiceValue(draft)}
                  disabled={disabled}
                  className={inputClassName}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "create") onChange(key, NEW_GROUP_DRAFT);
                    else if (value === "none") onChange(key, { kind: "none" });
                    else
                      onChange(key, {
                        kind: "existing",
                        groupId: value.slice("existing:".length),
                      });
                  }}
                >
                  <option value="create">{t.create}</option>
                  <option value="none">{t.none}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={`existing:${group.id}`}>
                      {fmt(t.existing, { name: group.name })}
                    </option>
                  ))}
                </select>
              </div>
              {draft.kind === "create" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor={`${id}-coach`}
                      className="text-sm font-medium"
                    >
                      {t.coach}
                    </label>
                    <select
                      id={`${id}-coach`}
                      value={draft.coachId}
                      disabled={disabled}
                      required
                      className={inputClassName}
                      onChange={(event) =>
                        onChange(key, { ...draft, coachId: event.target.value })
                      }
                    >
                      <option value="">{t.coachPlaceholder}</option>
                      {coaches.map((coach) => (
                        <option key={coach.id} value={coach.id}>
                          {coach.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor={`${id}-price`}
                      className="text-sm font-medium"
                    >
                      {t.price}
                    </label>
                    <input
                      id={`${id}-price`}
                      value={draft.price}
                      disabled={disabled}
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      aria-describedby={`${id}-price-hint`}
                      className={inputClassName}
                      onChange={(event) =>
                        onChange(key, { ...draft, price: event.target.value })
                      }
                    />
                    <p
                      id={`${id}-price-hint`}
                      className="text-xs text-muted-foreground"
                    >
                      {t.priceHint}
                    </p>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
