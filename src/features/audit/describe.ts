import { fmt } from "@/i18n/format";
import type { I18n, Messages } from "@/i18n/messages";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { isLocale, type Locale, LOCALE_NAMES } from "@/lib/locale";

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
  /** The parent a parent entry is about (step 21). */
  parentName: string | null;
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

/** Texts, language and "now" of the request the entries are described for. */
type Context = { t: Messages["audit"]; locale: Locale; now: Date };

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

function fieldList(
  { t }: Context,
  details: Record<string, unknown>,
): string | null {
  const names = strings(details.fields).map(
    (field) => label(t.fields, field) ?? field,
  );
  return names.length > 0 ? fmt(t.changed, { fields: names.join(", ") }) : null;
}

function present(lines: (string | null)[]): string[] {
  return lines.filter((line): line is string => line !== null && line !== "");
}

function paymentDetails(
  { t, locale, now }: Context,
  details: Record<string, unknown>,
): (string | null)[] {
  const amount = count(details.amount);
  const start = text(details.period_start);
  const end = text(details.period_end);
  const rule = text(details.rule_period_end);
  return [
    amount === null ? null : formatMoney(amount, locale),
    label(t.methods, text(details.method)),
    start && end
      ? fmt(t.period, {
          from: formatDate(start, now, locale),
          to: formatDate(end, now, locale),
        })
      : null,
    // D-16: a last day set by hand, next to the one the rule gave.
    details.period_end_changed === true && end && rule
      ? fmt(t.periodEndChanged, {
          date: formatDate(end, now, locale),
          rule: formatDate(rule, now, locale),
        })
      : null,
  ];
}

function exportDetails(
  { t, locale }: Context,
  details: Record<string, unknown>,
  entity: string,
) {
  const month = text(details.month);
  const rows = count(details.rows);
  return [
    entity === "payment"
      ? month
        ? fmt(t.exportPayments, { month: formatMonth(month, locale) })
        : null
      : t.exportClients,
    label(t.formats, text(details.format)),
    rows === null ? null : fmt(t.rows, { count: rows }),
  ];
}

function importDetails({ t }: Context, details: Record<string, unknown>) {
  const rows = count(details.rows);
  const created = count(details.created);
  const duplicates = count(details.duplicates);
  const groups = strings(details.groups_created).length;
  return [
    rows !== null && created !== null && duplicates !== null
      ? fmt(t.importCounts, { rows, created, duplicates })
      : null,
    groups > 0 ? fmt(t.groupsCreated, { count: groups }) : null,
  ];
}

function settingsDetails(context: Context, details: Record<string, unknown>) {
  const from = Array.isArray(details.from) ? details.from.join(", ") : null;
  const to = Array.isArray(details.to) ? details.to.join(", ") : null;
  return [
    fieldList(context, details),
    from && to ? fmt(context.t.days, { from, to }) : null,
  ];
}

function detailLines(context: Context, entry: AuditEntry): (string | null)[] {
  const { t, locale } = context;
  const { details } = entry;
  switch (entry.action) {
    case "payment.create":
      return paymentDetails(context, details);
    case "payment.cancel":
    case "payment.reverse": {
      const amount = count(details.amount);
      return [amount === null ? null : formatMoney(amount, locale)];
    }
    case "client.create": {
      const consents = strings(details.consents).length;
      return [consents > 0 ? fmt(t.consents, { count: consents }) : null];
    }
    case "client.update":
    case "parent.update":
    case "group.update":
      return [fieldList(context, details)];
    case "client.delete": {
      const reason = label(t.deleteReasons, text(details.reason));
      return [
        label(t.deleteModes, text(details.mode)),
        reason ? fmt(t.reason, { reason }) : null,
      ];
    }
    case "parent.delete": {
      const reason = label(t.deleteReasons, text(details.reason));
      return [reason ? fmt(t.reason, { reason }) : null];
    }
    case "client.import":
      return importDetails(context, details);
    case "group.archive": {
      const clients = count(details.active_clients);
      return [
        clients === null ? null : fmt(t.activeClients, { count: clients }),
      ];
    }
    case "settings.update":
      return settingsDetails(context, details);
    case "template.update": {
      const kind = label(t.templateKinds, text(details.kind));
      // Since step 19 the entry also names the template's language (D-13).
      const language = text(details.locale);
      return [
        kind && isLocale(language)
          ? fmt(t.templateLocale, { kind, language: LOCALE_NAMES[language] })
          : kind,
      ];
    }
    case "report.export":
      return exportDetails(context, details, entry.entity);
    case "staff.invite": {
      const role = label(t.roles, text(details.role));
      return [role ? fmt(t.role, { role }) : null];
    }
    case "staff.role_change": {
      const from = label(t.roles, text(details.from));
      const to = label(t.roles, text(details.to));
      return [from && to ? fmt(t.roleChange, { from, to }) : null];
    }
    default:
      return [];
  }
}

function clientTarget(
  t: Messages["audit"],
  entry: AuditEntry,
): AuditTarget | null {
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

function target(t: Messages["audit"], entry: AuditEntry): AuditTarget | null {
  if (entry.action === "report.export" || entry.action === "client.import") {
    return null;
  }
  if (entry.entity === "client" || entry.entity === "payment") {
    return clientTarget(t, entry);
  }
  if (entry.entity === "parent" && entry.entityId && entry.parentName) {
    return {
      label: t.target.parent,
      name: entry.parentName,
      href: `/parents/${entry.entityId}`,
      linkLabel: t.target.openParent,
    };
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
  { t, locale }: I18n,
  entry: AuditEntry,
  now: Date,
): AuditDescription {
  const context: Context = { t: t.audit, locale, now };
  return {
    title: t.audit.actions[entry.action],
    details: present(detailLines(context, entry)),
    target: target(t.audit, entry),
  };
}
