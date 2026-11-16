import { describe, expect, it } from "vitest";

import type { I18n } from "@/i18n/messages";
import { ru } from "@/i18n/ru";
import { formatDate, formatMoney } from "@/lib/format";

import { AUDIT_ACTION_GROUPS, AUDIT_ACTIONS } from "./actions";
import { type AuditEntry, describeAuditEntry } from "./describe";

const NOW = new Date("2026-11-14T09:00:00Z");
const RU: I18n = { t: ru, locale: "ru" };
const CLIENT = "3f1c2a7e-0000-4000-8000-000000000001";
const GROUP = "3f1c2a7e-0000-4000-8000-000000000002";
const ACTOR = "3f1c2a7e-0000-4000-8000-000000000003";
const OTHER = "3f1c2a7e-0000-4000-8000-000000000004";

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    id: "3f1c2a7e-0000-4000-8000-0000000000ff",
    createdAt: "2026-11-14T08:00:00Z",
    actorId: ACTOR,
    actorName: "Нурлан Тестов",
    action: "client.update",
    entity: "client",
    entityId: CLIENT,
    details: {},
    clientId: null,
    clientName: null,
    groupName: null,
    staffName: null,
    ...overrides,
  };
}

describe("describeAuditEntry", () => {
  it.each(AUDIT_ACTIONS)("%s has a plain-words title", (action) => {
    const { title } = describeAuditEntry(RU, entry({ action }), NOW);
    expect(title).toBe(ru.audit.actions[action]);
    expect(title).not.toContain(".");
  });

  it("the action filter offers every action exactly once", () => {
    const grouped = Object.values(AUDIT_ACTION_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it("payment: amount, method, period and a link to the client", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "payment.create",
        entity: "payment",
        details: {
          client_id: CLIENT,
          amount: 20000,
          method: "kaspi",
          period_start: "2026-11-14",
          period_end: "2026-12-13",
        },
        clientId: CLIENT,
        clientName: "Сериков Азамат",
      }),
      NOW,
    );
    expect(result.details).toEqual([
      formatMoney(20000, "ru"),
      "Kaspi",
      `период ${formatDate("2026-11-14", NOW, "ru")} – ${formatDate("2026-12-13", NOW, "ru")}`,
    ]);
    expect(result.target).toEqual({
      label: "Клиент",
      name: "Сериков Азамат",
      href: `/clients/${CLIENT}`,
      linkLabel: "Открыть карточку клиента",
    });
  });

  it("export of payments: month, format and rows, no single client", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "report.export",
        entity: "payment",
        entityId: null,
        details: { format: "xlsx", month: "2026-10", rows: 34 },
      }),
      NOW,
    );
    expect(result.details).toEqual([
      "оплаты за Октябрь 2026 г.",
      "Excel",
      "строк: 34",
    ]);
    expect(result.target).toBeNull();
  });

  it("export of clients", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "report.export",
        entity: "client",
        entityId: null,
        details: { format: "csv", rows: 120 },
      }),
      NOW,
    );
    expect(result.details).toEqual(["клиенты", "CSV", "строк: 120"]);
  });

  it("import: counts and created groups", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "client.import",
        entityId: null,
        details: {
          file_hash: "ab",
          rows: 40,
          created: 38,
          duplicates: 2,
          groups_created: [GROUP],
        },
      }),
      NOW,
    );
    expect(result.details).toEqual([
      "строк в файле: 40, добавлено: 38, похожих на дубли: 2",
      "новых групп: 1",
    ]);
    expect(result.target).toBeNull();
  });

  it("changed fields in plain words, reminder days from and to", () => {
    expect(
      describeAuditEntry(
        RU,
        entry({ details: { fields: ["last_name", "phone"] } }),
        NOW,
      ).details,
    ).toEqual(["Изменено: фамилия, телефон"]);
    expect(
      describeAuditEntry(
        RU,
        entry({
          action: "settings.update",
          entity: "settings",
          entityId: null,
          details: { fields: ["reminder_days"], from: [7, 1], to: [5, 1] },
        }),
        NOW,
      ).details,
    ).toEqual(["Изменено: дни напоминаний", "дни напоминаний: 7, 1 → 5, 1"]);
  });

  it("deleted client: mode and reason, no link", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "client.delete",
        details: { mode: "deleted", reason: "duplicate" },
      }),
      NOW,
    );
    expect(result.details).toEqual(["удалён полностью", "причина: дубль"]);
    expect(result.target).toEqual({
      label: "Клиент",
      name: "Клиент удалён",
      href: null,
      linkLabel: null,
    });
  });

  it("group entries link to the group", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "group.archive",
        entity: "group",
        entityId: GROUP,
        groupName: "Дети утро",
        details: { active_clients: 3 },
      }),
      NOW,
    );
    expect(result.details).toEqual(["клиентов в группе было: 3"]);
    expect(result.target?.href).toBe(`/groups/${GROUP}`);
  });

  it("staff: role change names the employee; own sign-in has no target", () => {
    const change = describeAuditEntry(
      RU,
      entry({
        action: "staff.role_change",
        entity: "staff",
        entityId: OTHER,
        staffName: "Данияр Примеров",
        details: { from: "admin", to: "owner" },
      }),
      NOW,
    );
    expect(change.details).toEqual(["администратор → владелец"]);
    expect(change.target?.name).toBe("Данияр Примеров");

    const login = describeAuditEntry(
      RU,
      entry({
        action: "staff.login",
        entity: "staff",
        entityId: ACTOR,
        staffName: "Нурлан Тестов",
      }),
      NOW,
    );
    expect(login.details).toEqual([]);
    expect(login.target).toBeNull();
  });

  it("ignores malformed details instead of failing the screen", () => {
    const result = describeAuditEntry(
      RU,
      entry({
        action: "payment.create",
        entity: "payment",
        details: { amount: "много", method: 5, fields: "x" },
      }),
      NOW,
    );
    expect(result.details).toEqual([]);
  });
});
