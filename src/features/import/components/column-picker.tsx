"use client";

import { inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import {
  COLUMN_KEYS,
  type ColumnKey,
  type ColumnMapping,
  REQUIRED_COLUMNS,
} from "../limits";

/** One select per field: which column of the file it comes from. */
export function ColumnPicker({
  headers,
  mapping,
  missing,
  disabled,
  onChange,
}: {
  headers: readonly string[];
  mapping: ColumnMapping;
  missing: readonly ColumnKey[];
  disabled: boolean;
  onChange: (mapping: ColumnMapping) => void;
}) {
  const importText = useText("import");
  const t = importText.columns;
  return (
    <section
      aria-labelledby="import-columns"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="import-columns" className="text-base font-semibold">
          {t.title}
        </h2>
        <p
          className={
            missing.length > 0
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
          role={missing.length > 0 ? "alert" : undefined}
        >
          {missing.length > 0 ? t.missing : t.hint}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {COLUMN_KEYS.map((key) => {
          const required = REQUIRED_COLUMNS.includes(key);
          const id = `import-column-${key}`;
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-sm font-medium">
                {t.fields[key]}
                {required ? (
                  <span className="text-muted-foreground"> ({t.required})</span>
                ) : null}
              </label>
              <select
                id={id}
                value={mapping[key] ?? ""}
                disabled={disabled}
                aria-invalid={missing.includes(key) || undefined}
                className={inputClassName}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange({
                    ...mapping,
                    [key]: value === "" ? null : Number(value),
                  });
                }}
              >
                <option value="">{t.none}</option>
                {headers.map((header, index) => (
                  <option key={index} value={index}>
                    {header === ""
                      ? fmt(t.column, { number: index + 1 })
                      : fmt(t.columnNamed, { number: index + 1, header })}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}
