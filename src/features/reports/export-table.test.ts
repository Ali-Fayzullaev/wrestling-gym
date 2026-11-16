import { describe, expect, it } from "vitest";

import { readXlsx } from "@/features/import/xlsx";
import { ru } from "@/i18n/ru";

import {
  buildExportFile,
  type ClientRow,
  clientsTable,
  type PaymentRow,
  paymentsTable,
} from "./export-table";

const payment: PaymentRow = {
  // 23:30 on 30 November in Almaty.
  created_at: "2026-11-30T18:30:00+00:00",
  kind: "payment",
  last_name: "Ахметов",
  first_name: "Алихан",
  group_name: "Дети 6–9 лет, утро",
  amount: 15000,
  method: "kaspi",
  period_start: "2026-12-01",
  period_end: "2026-12-31",
  reason: null,
  reversed: true,
  created_by: "Администратор Один",
};

const reversal: PaymentRow = {
  ...payment,
  created_at: "2026-11-30T18:40:00+00:00",
  kind: "reversal",
  amount: -15000,
  reason: '=HYPERLINK("http://example.test")',
  reversed: false,
};

const client: ClientRow = {
  last_name: "Ким",
  first_name: "Аружан",
  phone: "+77000000001",
  phone_owner: "parent",
  parent_name: "Гульнара",
  birth_date: "2017-04-02",
  group_name: null,
  started_on: "2026-01-10",
  status: "expired",
  ends_on: "2026-11-01",
  archived: false,
  note: "-не звонить после 21:00",
};

describe("paymentsTable", () => {
  it("writes one row per payment with Almaty time and readable values", () => {
    const table = paymentsTable([payment, reversal], ru.reports);
    expect(table.header).toEqual(ru.reports.file.paymentsHeader);
    expect(table.rows[0]).toEqual([
      "2026-11-30 23:30",
      "Оплата",
      "Ахметов",
      "Алихан",
      "Дети 6–9 лет, утро",
      15000,
      "Kaspi",
      "2026-12-01",
      "2026-12-31",
      "Да",
      null,
      "Администратор Один",
    ]);
    // A reversal is not itself "reversed"; that column stays empty for it.
    expect(table.rows[1]?.[1]).toBe("Сторно");
    expect(table.rows[1]?.[5]).toBe(-15000);
    expect(table.rows[1]?.[9]).toBeNull();
    expect(table.widths).toHaveLength(table.header.length);
  });
});

describe("clientsTable", () => {
  it("translates codes to words and keeps empty values empty", () => {
    const [row] = clientsTable([client], ru.reports).rows;
    expect(row).toEqual([
      "Ким",
      "Аружан",
      "+77000000001",
      "Родителя",
      "Гульнара",
      "2017-04-02",
      null,
      "2026-01-10",
      "Долг",
      "2026-11-01",
      "Нет",
      "-не звонить после 21:00",
    ]);
  });
});

describe("buildExportFile", () => {
  it("builds an .xlsx that reads back with the header and rows", () => {
    const file = buildExportFile(
      paymentsTable([payment, reversal], ru.reports),
      "xlsx",
      "payments-2026-11",
      "Оплаты",
    );
    expect(file.fileName).toBe("payments-2026-11.xlsx");
    expect(file.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const rows = readXlsx(file.body);
    expect(rows[0]).toEqual([...ru.reports.file.paymentsHeader]);
    expect(rows[1]?.[2]).toBe("Ахметов");
    expect(rows[1]?.[5]).toBe(15000);
    // Formula-like text arrives as text, unchanged (Excel's quote prefix keeps it from running).
    expect(rows[2]?.[10]).toBe('=HYPERLINK("http://example.test")');
  });

  it("builds a CSV with a BOM, the header first and formula-like cells neutralised", () => {
    const file = buildExportFile(
      clientsTable([client], ru.reports),
      "csv",
      "clients-2026-11-14",
      "Клиенты",
    );
    expect(file.fileName).toBe("clients-2026-11-14.csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      file.body,
    );
    const [header, line] = text.split("\r\n");
    expect(header).toBe(`﻿${ru.reports.file.clientsHeader.join(";")}`);
    expect(line).toBe(
      "Ким;Аружан;+77000000001;Родителя;Гульнара;2017-04-02;;2026-01-10;Долг;2026-11-01;Нет;'-не звонить после 21:00",
    );
  });

  it("never puts personal data in the file name", () => {
    const file = buildExportFile(
      clientsTable([client], ru.reports),
      "xlsx",
      "clients-2026-11-14",
      "Клиенты",
    );
    expect(file.fileName).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
