import { formatMonth } from "@/features/reports/month";
import { auditText as t } from "@/i18n/audit";
import { formatDate, formatMoney } from "@/lib/format";

import type { AuditAction } from "./actions";

/** One journal entry as audit_feed() returns it, after shape checks. */
export type AuditEntry = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
  /** The client the entry is about (directly or through a payment), if it still exists. */
  clientId: string | null;
  clientName: string | null;
  groupName: string | null;
  staffName: string | null;
};

export type AuditTarget = {
  label: string;
  name: string;
  href: string | null;
  linkLabel: string | null;
};

export type AuditDescription = {
  title: string;
  details: string[];
  target: AuditTarget | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function label<T extends Record<string, string>>(
  labels: T,
  key: string | null,
): string | null {
  if (key === null) return null;
  return Object.hasOwn(labels, key) ? (labels[key] ?? null) : key;
}

function fieldList(details: Record<string, unknown>): string | null {
  const names = strings(details.fields).map(
    (field) => label(t.fields, field) ?? field,
  );
  return names.length > 0 ? t.changed(names.join(", ")) : null;
}

function present(lines: (string | null)[]): string[] {
  return lines.filter((line): line is string => line !== null && line !== "");
}

function paymentDetails(
  details: Record<string, unknown>,
  now: Date,
): (string | null)[] {
  const amount = count(details.amount);
  const start = text(details.period_start);
  const end = text(details.period_end);
  return [
    amount === null ? null : formatMoney(amount),
    label(t.methods, text(details.method)),
    start && end
      ? t.period(formatDate(start, now), formatDate(end, now))
      : null,
  ];
}

function exportDetails(details: Record<string, unknown>, entity: string) {
  const month = text(details.month);
  const rows = count(details.rows);
  return [
    entity === "payment"
      ? month
        ? t.exportPayments(formatMonth(month))
        : null
      : t.exportClients,
    label(t.formats, text(details.format)),
    rows === null ? null : t.rows(rows),
  ];
}

function importDetails(details: Record<string, unknown>) {
  const rows = count(details.rows);
  const created = count(details.created);
  const duplicates = count(details.duplicates);
  const groups = strings(details.groups_created).length;
  return [
    rows !== null && created !== null && duplicates !== null
      ? t.importCounts(rows, created, duplicates)
      : null,
    groups > 0 ? t.groupsCreated(groups) : null,
  ];
}

function settingsDetails(details: Record<string, unknown>) {
  const from = Array.isArray(details.from) ? details.from.join(", ") : null;
  const to = Array.isArray(details.to) ? details.to.join(", ") : null;
  return [fieldList(details), from && to ? t.days(from, to) : null];
}

function detailLines(entry: AuditEntry, now: Date): (string | null)[] {
  const { details } = entry;
  switch (entry.action) {
    case "payment.create":
      return paymentDetails(details, now);
    case "payment.cancel":
    case "payment.reverse": {
      const amount = count(details.amount);
      return [amount === null ? null : formatMoney(amount)];
    }
    case "client.create": {
      const consents = strings(details.consents).length;
      return [consents > 0 ? t.consents(consents) : null];
    }
    case "client.update":
    case "group.update":
      return [fieldList(details)];
    case "client.delete": {
      const reason = label(t.deleteReasons, text(details.reason));
      return [
        label(t.deleteModes, text(details.mode)),
        reason ? t.reason(reason) : null,
      ];
    }
    case "client.import":
      return importDetails(details);
    case "group.archive": {
      const clients = count(details.active_clients);
      return [clients === null ? null : t.activeClients(clients)];
    }
    case "settings.update":
      return settingsDetails(details);
    case "template.update":
      return [label(t.templateKinds, text(details.kind))];
    case "report.export":
      return exportDetails(details, entry.entity);
    case "staff.invite": {
      const role = label(t.roles, text(details.role));
      return [role ? t.role(role) : null];
    }
    case "staff.role_change": {
      const from = label(t.roles, text(details.from));
      const to = label(t.roles, text(details.to));
      return [from && to ? t.roleChange(from, to) : null];
    }
    default:
      return [];
  }
}

function clientTarget(entry: AuditEntry): AuditTarget | null {
  if (entry.clientId && entry.clientName) {
    return {
      label: t.target.client,
      name: entry.clientName,
      href: `/clients/${entry.clientId}`,
      linkLabel: t.target.openClient,
    };
  }
  // A client-wide entry (import, export) names no single client.
  if (entry.entityId === null && entry.action !== "client.delete") return null;
  return {
    label: t.target.client,
    name: t.target.deletedClient,
    href: null,
    linkLabel: null,
  };
}

function target(entry: AuditEntry): AuditTarget | null {
  if (entry.action === "report.export" || entry.action === "client.import") {
    return null;
  }
  if (entry.entity === "client" || entry.entity === "payment") {
    return clientTarget(entry);
  }
  if (entry.entity === "group" && entry.entityId && entry.groupName) {
    return {
      label: t.target.group,
      name: entry.groupName,
      href: `/groups/${entry.entityId}`,
      linkLabel: t.target.openGroup,
    };
  }
  // Sign-in and password change are about the actor themselves: no separate target.
  if (
    entry.entity === "staff" &&
    entry.staffName &&
    entry.entityId !== entry.actorId
  ) {
    return {
      label: t.target.staff,
      name: entry.staffName,
      href: null,
      linkLabel: null,
    };
  }
  return null;
}

/** What the owner reads for one entry: a plain-words title, details and what it is about. */
export function describeAuditEntry(
  entry: AuditEntry,
  now: Date,
): AuditDescription {
  return {
    title: t.actions[entry.action],
    details: present(detailLines(entry, now)),
    target: target(entry),
  };
}
