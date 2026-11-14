"use client";

import { Info } from "lucide-react";
import { useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { importText } from "@/i18n/import";
import { formatDate } from "@/lib/format";

import { groupKey } from "../group-key";
import type { ColumnMapping } from "../limits";
import type {
  GroupChoice,
  GroupChoices,
  ImportError,
  ImportReport,
  ImportResult,
  PreviewData,
} from "../result";
import { ColumnPicker } from "./column-picker";
import { importForm } from "./form-data";
import {
  GroupDecisions,
  type GroupDraft,
  isDraftComplete,
  NEW_GROUP_DRAFT,
  parsePrice,
} from "./group-decisions";
import { PreviewRows } from "./preview-rows";

const t = importText;

function toChoice(draft: GroupDraft): GroupChoice {
  if (draft.kind !== "create") return draft;
  return {
    kind: "create",
    coachId: draft.coachId,
    price: parsePrice(draft.price) ?? 0,
  };
}

/**
 * Everything after the file is read: columns, the summary, decisions about new groups, every row
 * with its status and the import button. Loaded only once a file has been chosen.
 */
export function ImportReview({
  file,
  data,
  today,
  busy,
  onRemap,
  commit,
  onDone,
}: {
  file: File;
  data: PreviewData;
  today: Date;
  /** A new preview is being read; nothing may be changed meanwhile. */
  busy: boolean;
  onRemap: (mapping: ColumnMapping) => void;
  commit: (form: FormData) => Promise<ImportResult<ImportReport>>;
  onDone: (report: ImportReport) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, GroupDraft>>({});
  const [error, setError] = useState<ImportError | "network" | null>(null);
  const [pending, startTransition] = useTransition();
  const disabled = busy || pending;

  const unknown = data.unknownGroups.map((name) => ({
    key: groupKey(name),
    name,
  }));
  const draftOf = (key: string) => drafts[key] ?? NEW_GROUP_DRAFT;
  const groupsReady = unknown.every(({ key }) => isDraftComplete(draftOf(key)));
  const canImport = data.missing.length === 0 && data.counts.new > 0;

  const submit = () => {
    if (!canImport || !groupsReady) return;
    const groups: GroupChoices = {};
    for (const { key } of unknown) groups[key] = toChoice(draftOf(key));
    setError(null);
    startTransition(async () => {
      try {
        const result = await commit(
          importForm(file, { mapping: data.mapping, groups }),
        );
        if (result.ok) onDone(result.data);
        else setError(result.error);
      } catch {
        setError("network");
      }
    });
  };

  return (
    <>
      <ColumnPicker
        headers={data.headers}
        mapping={data.mapping}
        missing={data.missing}
        disabled={disabled}
        onChange={onRemap}
      />
      {data.missing.length === 0 ? (
        <>
          <section
            aria-labelledby="import-summary"
            className="flex flex-col gap-3"
          >
            <h2 id="import-summary" className="text-base font-semibold">
              {t.summary.title}
            </h2>
            <dl className="grid grid-cols-3 gap-2">
              {(["new", "duplicate", "error"] as const).map((status) => (
                <div
                  key={status}
                  className="flex flex-col gap-1 rounded-xl border bg-card p-3"
                >
                  <dt className="text-xs text-muted-foreground">
                    {t.summary[status]}
                  </dt>
                  <dd
                    className="text-2xl font-semibold tabular-nums"
                    data-testid={`import-count-${status}`}
                  >
                    {data.counts[status]}
                  </dd>
                </div>
              ))}
            </dl>
            {data.importedAt ? (
              <p className="flex gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t.summary.importedBefore(
                  formatDate(new Date(data.importedAt), today),
                )}
              </p>
            ) : null}
          </section>
          {unknown.length > 0 ? (
            <GroupDecisions
              names={unknown}
              drafts={drafts}
              groups={data.groups}
              coaches={data.coaches}
              disabled={disabled}
              onChange={(key, draft) =>
                setDrafts((current) => ({ ...current, [key]: draft }))
              }
            />
          ) : null}
          <PreviewRows
            key={data.rows.length}
            rows={data.rows}
            counts={data.counts}
            today={today}
          />
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-col gap-2 rounded-xl border bg-background/95 p-3 backdrop-blur md:bottom-4">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t.errors[error]}
              </p>
            ) : !canImport ? (
              <p className="text-sm text-muted-foreground">
                {t.nothingToImport}
              </p>
            ) : !groupsReady ? (
              <p className="text-sm text-muted-foreground">{t.unresolved}</p>
            ) : null}
            {canImport ? (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !canImport || !groupsReady}
                className={buttonVariants({ size: "lg" })}
                data-testid="import-submit"
              >
                {pending ? t.submitting : t.submit(data.counts.new)}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
