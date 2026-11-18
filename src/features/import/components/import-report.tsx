"use client";

import { CircleCheck, Download } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/variants";
import { useLocale, useText } from "@/i18n/client";
import { fmt, plural } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { toCsv } from "@/lib/csv-write";

import type { ImportReport as Report } from "../result";

/** The skipped rows as they were, plus a column with what to fix, as a file to download. */
function downloadSkipped(importText: Messages["import"], report: Report) {
  const t = importText.report;
  const rows = [
    [...report.headers, t.errorColumn],
    ...report.skipped.map((row) => [
      ...row.cells,
      row.errors.map((error) => importText.row.errors[error]).join("; "),
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = importText.skippedFileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportReport({
  report,
  onAgain,
}: {
  report: Report;
  onAgain: () => void;
}) {
  const importText = useText("import");
  const t = importText.report;
  const locale = useLocale();
  return (
    <section
      aria-labelledby="import-report"
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
      data-testid="import-report"
    >
      <h2
        id="import-report"
        className="flex items-center gap-2 text-base font-semibold"
      >
        <CircleCheck
          aria-hidden
          className="size-5 text-status-active-foreground"
        />
        {t.title}
      </h2>
      <ul className="flex flex-col gap-1 text-sm" role="status">
        <li className="font-medium">
          {fmt(t.created, { count: report.created })}
        </li>
        {report.duplicates > 0 ? (
          <li>{fmt(t.duplicates, { count: report.duplicates })}</li>
        ) : null}
        {report.parentsCreated > 0 ? (
          <li>{fmt(t.parents, { count: report.parentsCreated })}</li>
        ) : null}
        {report.groupsCreated > 0 ? (
          <li>{fmt(t.groups, { count: report.groupsCreated })}</li>
        ) : null}
      </ul>
      {report.created > 0 ? (
        <p className="text-sm text-muted-foreground">{t.note}</p>
      ) : null}
      {report.skipped.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-3 text-sm">
          <p>{plural(locale, t.skipped, report.skipped.length)}</p>
          <button
            type="button"
            onClick={() => downloadSkipped(importText, report)}
            className={buttonVariants({
              variant: "outline",
              className: "w-fit",
            })}
          >
            <Download aria-hidden />
            {t.download}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link href="/clients" className={buttonVariants()}>
          {t.toClients}
        </Link>
        <button
          type="button"
          onClick={onAgain}
          className={buttonVariants({ variant: "outline" })}
        >
          {t.again}
        </button>
      </div>
    </section>
  );
}
