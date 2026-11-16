"use client";

import { FileSpreadsheet, Upload } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import { ACCEPTED_FILES, type ColumnMapping, MAX_FILE_BYTES } from "../limits";
import type {
  ImportError,
  ImportReport as Report,
  ImportResult,
  PreviewData,
} from "../result";
import { importForm } from "./form-data";

// The preview and the report (with their texts) load once a file is chosen, so the screen's
// first load is only the file picker.
const ImportReview = dynamic(() =>
  import("./import-review").then((m) => m.ImportReview),
);
const ImportReport = dynamic(() =>
  import("./import-report").then((m) => m.ImportReport),
);

type Action<T> = (form: FormData) => Promise<ImportResult<T>>;

/**
 * Upload, choose columns, check the preview, decide about new groups, import. The file stays in
 * the browser and is sent with each step; it is parsed on the server only.
 */
export function ImportWizard({
  today,
  preview,
  commit,
}: {
  today: Date;
  preview: Action<PreviewData>;
  commit: Action<Report>;
}) {
  const t = useText("importUpload");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<ImportError | "network" | null>(null);
  const [pending, startTransition] = useTransition();

  const read = (chosen: File, mapping: ColumnMapping | null) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await preview(
          importForm(chosen, mapping ? { mapping } : {}),
        );
        if (result.ok) setData(result.data);
        else setError(result.error);
      } catch {
        setError("network");
      }
    });
  };

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setData(null);
    if (chosen.size > MAX_FILE_BYTES) setError("too_large");
    else read(chosen, null);
  };

  // On a slow connection the file may be picked before the page is interactive; the browser keeps
  // it in the input, so it is read as soon as the page is.
  useEffect(() => {
    const picked = inputRef.current?.files?.[0];
    if (picked) choose(picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const reset = () => {
    setFile(null);
    setData(null);
    setReport(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  if (report) return <ImportReport report={report} onAgain={reset} />;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <label htmlFor={inputId} className="text-base font-semibold">
          {t.file.label}
        </label>
        <p id={`${inputId}-hint`} className="text-sm text-muted-foreground">
          {t.file.hint}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_FILES}
            disabled={pending}
            aria-describedby={`${inputId}-hint`}
            className="peer sr-only"
            data-testid="import-file"
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <label
            htmlFor={inputId}
            className={buttonVariants({
              variant: file ? "outline" : "default",
              className:
                "cursor-pointer peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50",
            })}
          >
            <Upload aria-hidden />
            {file ? t.file.another : t.file.choose}
          </label>
          <a
            href="/clients/import/template"
            download
            className={buttonVariants({ variant: "ghost" })}
          >
            <FileSpreadsheet aria-hidden />
            {t.file.template}
          </a>
        </div>
        {file ? <p className="text-sm break-all">{file.name}</p> : null}
        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {pending ? t.file.reading : ""}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t.errors[error]}
          </p>
        ) : null}
      </section>
      {file && data ? (
        <ImportReview
          file={file}
          data={data}
          today={today}
          busy={pending}
          onRemap={(mapping) => read(file, mapping)}
          commit={commit}
          onDone={setReport}
        />
      ) : null}
    </div>
  );
}
