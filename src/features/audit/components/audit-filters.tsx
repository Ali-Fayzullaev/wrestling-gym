import { Filter, X } from "lucide-react";
import Link from "next/link";
import type * as React from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { auditText as t } from "@/i18n/audit";

import { AUDIT_ACTION_GROUPS } from "../actions";
import type { AuditQuery } from "../schema";

/**
 * A plain GET form: it works before any script loads and keeps the filter in the address, so a
 * filtered journal can be reloaded or shared with another owner.
 */
export function AuditFilters({
  query,
  staff,
  filtered,
}: {
  query: AuditQuery;
  staff: { id: string; name: string }[];
  filtered: boolean;
}) {
  return (
    <form
      method="get"
      action="/audit"
      aria-label={t.filters.title}
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end"
    >
      <Labelled id="audit-staff" label={t.filters.staff}>
        <select
          id="audit-staff"
          name="staff"
          defaultValue={query.staff ?? ""}
          className={inputClassName}
        >
          <option value="">{t.filters.allStaff}</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled id="audit-action" label={t.filters.action}>
        <select
          id="audit-action"
          name="action"
          defaultValue={query.action ?? ""}
          className={inputClassName}
        >
          <option value="">{t.filters.allActions}</option>
          {Object.entries(AUDIT_ACTION_GROUPS).map(([group, actions]) => (
            <optgroup
              key={group}
              label={t.groups[group as keyof typeof t.groups]}
            >
              {actions.map((action) => (
                <option key={action} value={action}>
                  {t.actions[action]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Labelled>
      <Labelled id="audit-from" label={t.filters.from}>
        <input
          id="audit-from"
          name="from"
          type="date"
          defaultValue={query.from ?? ""}
          className={inputClassName}
        />
      </Labelled>
      <Labelled id="audit-to" label={t.filters.to}>
        <input
          id="audit-to"
          name="to"
          type="date"
          defaultValue={query.to ?? ""}
          className={inputClassName}
        />
      </Labelled>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <button type="submit" className={buttonVariants()}>
          <Filter aria-hidden />
          {t.filters.apply}
        </button>
        {filtered ? (
          <Link
            href="/audit"
            className={buttonVariants({ variant: "outline" })}
          >
            <X aria-hidden />
            {t.filters.reset}
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function Labelled({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
