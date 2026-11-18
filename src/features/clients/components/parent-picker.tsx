"use client";

import { Search, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import type { ParentOption, ParentResult } from "@/features/parents/service";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_NAMES, LOCALES } from "@/lib/locale";
import { formatPhone } from "@/lib/phone";

import {
  clientFormFields as fields,
  NAME_MAX,
  type ParentMode,
} from "../form-fields";
import type { ClientField } from "../schema";

export type SearchParents = (input: {
  query: string;
}) => Promise<ParentResult<ParentOption[]>>;

// Waits for a pause in typing before asking the server, so one request goes out per word.
const SEARCH_DELAY_MS = 250;
const QUERY_MIN = 2;

type SearchState =
  | { phase: "idle" }
  | { phase: "searching" }
  | { phase: "done"; found: ParentOption[] }
  | { phase: "failed" };

/**
 * The parent of a child (D-18): find one already on file by name or phone, or enter a new one
 * (name, phone, language). The choice travels in ordinary form fields: parentMode, and parentId or
 * the newParent* fields; the server checks them again.
 */
export function ParentPicker({
  initial,
  invalid,
  search,
}: {
  /** The parent already chosen (an edited child, or "another child of this parent"). */
  initial: ParentOption | null;
  invalid: ReadonlySet<ClientField>;
  search: SearchParents;
}) {
  const f = useText("clientForm");
  const id = useId();
  const [mode, setMode] = useState<ParentMode>("existing");
  const [chosen, setChosen] = useState<ParentOption | null>(initial);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ phase: "idle" });
  // The newest query: an older answer arriving late is dropped.
  const latest = useRef("");

  useEffect(() => {
    const text = query.trim();
    latest.current = text;
    if (text.length < QUERY_MIN) return;
    const timer = setTimeout(() => {
      setState({ phase: "searching" });
      search({ query: text })
        .then((result) => {
          if (latest.current !== text) return;
          setState(
            result.ok
              ? { phase: "done", found: result.data }
              : { phase: "failed" },
          );
        })
        .catch(() => {
          if (latest.current === text) setState({ phase: "failed" });
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  // A too short text shows nothing, whatever an earlier search found.
  const shown: SearchState =
    query.trim().length < QUERY_MIN ? { phase: "idle" } : state;

  const error = (field: ClientField) =>
    invalid.has(field) ? `${id}-${field}-error` : undefined;

  return (
    <fieldset className="grid gap-3" data-testid="parent-picker">
      <legend className="mb-1.5 text-sm font-medium">{f.parent}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {(["existing", "new"] as const).map((option) => (
          <label
            key={option}
            className="flex min-h-11 items-center gap-2.5 text-sm"
          >
            <input
              type="radio"
              name={fields.parentMode}
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
              className="size-5 shrink-0 accent-primary"
            />
            {option === "existing" ? f.parentFind : f.parentNew}
          </label>
        ))}
      </div>

      {mode === "existing" ? (
        chosen ? (
          <div
            className="flex flex-col gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            data-testid="parent-chosen"
          >
            <input type="hidden" name={fields.parentId} value={chosen.id} />
            <ParentSummary parent={chosen} />
            <button
              type="button"
              className={buttonVariants({ variant: "outline" })}
              onClick={() => setChosen(null)}
            >
              {f.parentChange}
            </button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-search`} className="text-sm font-medium">
              {f.parentSearch}
            </label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id={`${id}-search`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                aria-invalid={invalid.has("parentId") || undefined}
                aria-describedby={
                  [`${id}-search-hint`, error("parentId")]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                className={`${inputClassName} pl-9`}
              />
            </div>
            <p
              id={`${id}-search-hint`}
              className="text-sm text-muted-foreground"
            >
              {f.parentSearchHint}
            </p>
            {invalid.has("parentId") ? (
              <p
                id={`${id}-parentId-error`}
                className="text-sm text-destructive"
              >
                {f.errors.parentId}
              </p>
            ) : null}
            <div role="status" className="text-sm empty:hidden">
              {shown.phase === "searching" ? (
                <p className="text-muted-foreground">{f.parentSearching}</p>
              ) : null}
              {shown.phase === "failed" ? (
                <p className="text-status-expired-foreground">
                  {f.parentSearchFailed}
                </p>
              ) : null}
              {shown.phase === "done" && shown.found.length === 0 ? (
                <p className="text-muted-foreground">{f.parentNotFound}</p>
              ) : null}
            </div>
            {shown.phase === "done" && shown.found.length > 0 ? (
              <ul
                className="flex flex-col divide-y rounded-lg border"
                data-testid="parent-results"
              >
                {shown.found.map((parent) => (
                  <li key={parent.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted"
                      onClick={() => setChosen(parent)}
                    >
                      <ParentSummary parent={parent} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id={id}
            field="newParentName"
            label={f.newParentName}
            hint={f.newParentNameHint}
            invalid={invalid}
          >
            <input
              id={`${id}-newParentName`}
              name={fields.newParentName}
              maxLength={NAME_MAX}
              autoComplete="off"
              required
              aria-invalid={invalid.has("newParentName") || undefined}
              aria-describedby={[
                `${id}-newParentName-hint`,
                error("newParentName"),
              ]
                .filter(Boolean)
                .join(" ")}
              className={inputClassName}
            />
          </TextField>
          <TextField
            id={id}
            field="newParentPhone"
            label={f.newParentPhone}
            hint={f.phoneHint}
            invalid={invalid}
          >
            <input
              id={`${id}-newParentPhone`}
              name={fields.newParentPhone}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              required
              aria-invalid={invalid.has("newParentPhone") || undefined}
              aria-describedby={[
                `${id}-newParentPhone-hint`,
                error("newParentPhone"),
              ]
                .filter(Boolean)
                .join(" ")}
              className={`${inputClassName} tabular-nums`}
            />
          </TextField>
          <TextField
            id={id}
            field="newParentLocale"
            label={f.newParentLocale}
            hint={f.newParentLocaleHint}
            invalid={invalid}
          >
            <select
              id={`${id}-newParentLocale`}
              name={fields.newParentLocale}
              defaultValue={DEFAULT_LOCALE}
              aria-describedby={`${id}-newParentLocale-hint`}
              className={inputClassName}
            >
              {LOCALES.map((option) => (
                <option key={option} value={option} lang={HTML_LANG[option]}>
                  {LOCALE_NAMES[option]}
                </option>
              ))}
            </select>
          </TextField>
        </div>
      )}
    </fieldset>
  );
}

function ParentSummary({ parent }: { parent: ParentOption }) {
  const f = useText("clientForm");
  return (
    <span className="flex min-w-0 items-start gap-2.5">
      <UserRound aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium break-words">{parent.name}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatPhone(parent.phone)}
        </span>
        {parent.children === null ? null : (
          <span className="break-words text-muted-foreground">
            {parent.children.length > 0
              ? fmt(f.parentChildren, { names: parent.children.join(", ") })
              : f.parentNoChildren}
          </span>
        )}
      </span>
    </span>
  );
}

function TextField({
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
  hint: string;
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
      <p id={`${id}-${field}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
      {invalid.has(field) ? (
        <p id={`${id}-${field}-error`} className="text-sm text-destructive">
          {f.errors[field as keyof typeof f.errors]}
        </p>
      ) : null}
    </div>
  );
}
