"use client";

import type { ReactNode } from "react";

import { useText } from "@/i18n/client";

import type { ClientField } from "../schema";

/** The props that tie a control to its label, hint and error inside a Field. */
export function fieldControl(
  id: string,
  field: ClientField,
  invalid: ReadonlySet<ClientField>,
  hint = false,
) {
  const describedBy =
    [
      hint ? `${id}-${field}-hint` : null,
      invalid.has(field) ? `${id}-${field}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return {
    id: `${id}-${field}`,
    "aria-invalid": invalid.has(field) || undefined,
    "aria-describedby": describedBy,
  };
}

export function Field({
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
