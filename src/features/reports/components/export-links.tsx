import { Download } from "lucide-react";

import { reportsText } from "@/i18n/reports";

const t = reportsText.export;

const LINK =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring";

/**
 * Plain download links to the route handler: the file is built on the server, so the export adds
 * nothing to the screen's JavaScript. Not next/link, which would prefetch a download.
 */
export function ExportLinks({ month }: { month: string }) {
  const rows = [
    {
      key: "payments",
      title: t.payments,
      query: `data=payments&month=${month}`,
    },
    { key: "clients", title: t.clients, query: "data=clients" },
  ] as const;
  return (
    <section
      aria-labelledby="export-title"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="export-title" className="text-base font-semibold">
          {t.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.hint}</p>
      </div>
      <ul className="flex flex-col divide-y">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <span className="text-sm font-medium">{row.title}</span>
            <span className="flex gap-2">
              {(["xlsx", "csv"] as const).map((format) => (
                <a
                  key={format}
                  href={`/reports/export?${row.query}&format=${format}`}
                  download
                  aria-label={t.download(row.title, t[format])}
                  data-testid={`export-${row.key}-${format}`}
                  className={LINK}
                >
                  <Download aria-hidden className="size-4" />
                  {t[format]}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
