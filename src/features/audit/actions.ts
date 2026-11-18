/**
 * Every action the audit log may hold: the same list as the audit_log_action_known check in the
 * database (supabase/migrations/*_families_followup.sql). A new action needs both.
 */
export const AUDIT_ACTIONS = [
  "staff.login",
  "staff.password_change",
  "staff.password_reset",
  "staff.invite",
  "staff.role_change",
  "staff.deactivate",
  "staff.activate",
  "client.create",
  "client.update",
  "client.archive",
  "client.restore",
  "client.delete",
  "client.move",
  "client.import",
  "parent.create",
  "parent.update",
  "parent.archive",
  "parent.restore",
  "parent.delete",
  "group.create",
  "group.update",
  "group.archive",
  "payment.create",
  "payment.cancel",
  "payment.reverse",
  "settings.update",
  "template.update",
  "report.export",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

export function isAuditAction(value: string): value is AuditAction {
  return ACTION_SET.has(value);
}

/** Groups of the action filter, in the order the owner reads them. */
export const AUDIT_ACTION_GROUPS = {
  payments: ["payment.create", "payment.cancel", "payment.reverse"],
  clients: [
    "client.create",
    "client.update",
    "client.archive",
    "client.restore",
    "client.delete",
    "client.move",
    "client.import",
    "parent.create",
    "parent.update",
    "parent.archive",
    "parent.restore",
    "parent.delete",
  ],
  groups: ["group.create", "group.update", "group.archive"],
  settings: ["settings.update", "template.update"],
  reports: ["report.export"],
  staff: [
    "staff.login",
    "staff.password_change",
    "staff.password_reset",
    "staff.invite",
    "staff.role_change",
    "staff.deactivate",
    "staff.activate",
  ],
} as const satisfies Record<string, readonly AuditAction[]>;
