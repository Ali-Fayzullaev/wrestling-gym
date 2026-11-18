"use client";

import { Save } from "lucide-react";
import { type FormEvent, useId, useState, useTransition } from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useLocale, useText } from "@/i18n/client";
import { fmt, plural } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import {
  DEFAULT_LOCALE,
  HTML_LANG,
  type Locale,
  LOCALE_NAMES,
  LOCALES,
} from "@/lib/locale";

import type { TemplateKind } from "../kinds";
import type { SettingsFieldErrors, SettingsResult } from "../result";
import { BODY_MAX, DAYS_MAX, DAYS_MIN } from "../limits";
import {
  type FamilyChild,
  familyValues,
  isDraftTemplate,
  type ReminderContact,
  type ReminderTemplate,
  reminderValues,
  renderTemplate,
  unknownVariables,
} from "../template";

export type SaveReminderSettings = (input: {
  firstDays: string;
  secondDays: string;
  templates: { id: string; body: string }[];
}) => Promise<SettingsResult>;

const ORDER: Record<TemplateKind, number> = {
  before_7: 0,
  before_1: 1,
  overdue: 2,
  family: 3,
};

function kindTitle(
  r: Messages["reminders"],
  locale: Locale,
  kind: TemplateKind,
  first: number,
  second: number | null,
) {
  if (kind === "family") return r.kinds.family;
  if (kind === "overdue") return r.kinds.overdue;
  if (kind === "before_7") return plural(locale, r.kinds.first, first);
  return second === null
    ? r.kindShort.before_1
    : plural(locale, r.kinds.second, second);
}

const parseDays = (value: string): number | null => {
  const days = Number(value);
  return value.trim() !== "" &&
    Number.isInteger(days) &&
    days >= DAYS_MIN &&
    days <= DAYS_MAX
    ? days
    : null;
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The filled-in text with every unknown `{...}` highlighted, as the client would read it. */
function Preview({ text, unknown }: { text: string; unknown: string[] }) {
  if (unknown.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${unknown.map(escapeRegExp).join("|")})`, "g");
  return (
    <>
      {text.split(pattern).map((part, index) =>
        unknown.includes(part) ? (
          <mark
            key={index}
            className="rounded-sm bg-status-expiring px-0.5 text-status-expiring-foreground"
            data-testid="unknown-variable"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Days and texts of reminders on one screen, saved with one button. Texts are per language
 * (D-13): a switcher shows one language at a time, and every language is saved together. The
 * preview fills the texts with a real client's data, the date and amount in the text's language,
 * as the owner types; nothing is sent from here.
 */
export function ReminderSettingsForm({
  reminderDays,
  templates,
  gymName,
  preview,
  previewName,
  familyPreview,
  today,
  save,
}: {
  reminderDays: number[];
  templates: ReminderTemplate[];
  gymName: string;
  preview: ReminderContact;
  /** Made-up parent and children the "several children" text is shown on (D-18). */
  familyPreview: { parentName: string; children: FamilyChild[] };
  /** The real client the preview uses; null when it is made-up data. */
  previewName: string | null;
  today: Date;
  save: SaveReminderSettings;
}) {
  const r = useText("reminders");
  const t = r.settings;
  const locale = useLocale();
  const id = useId();
  const sorted = [...reminderDays].sort((a, b) => b - a);
  const [firstDays, setFirstDays] = useState(String(sorted[0] ?? ""));
  const [secondDays, setSecondDays] = useState(
    sorted[1] === undefined ? "" : String(sorted[1]),
  );
  const [bodies, setBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(templates.map((item) => [item.id, item.body])),
  );
  const [language, setLanguage] = useState<Locale>(DEFAULT_LOCALE);
  const [errors, setErrors] = useState<SettingsFieldErrors>({});
  const [message, setMessage] = useState<
    "saved" | "forbidden" | "unavailable" | null
  >(null);
  const [pending, startTransition] = useTransition();

  const values = reminderValues(preview, gymName, today, language);
  const family = familyValues(
    familyPreview.parentName,
    familyPreview.children,
    gymName,
    today,
    language,
  );
  const first = parseDays(firstDays) ?? sorted[0] ?? 0;
  const second = secondDays.trim() === "" ? null : parseDays(secondDays);
  const ordered = [...templates].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const shown = ordered.filter((item) => item.locale === language);
  // The "several children" texts are drafts in Russian too; they carry their own mark.
  const draftLocales = new Set(
    templates
      .filter((item) => item.kind !== "family" && isDraftTemplate(item))
      .map((item) => item.locale),
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await save({
          firstDays,
          secondDays,
          templates: ordered.map((item) => ({
            id: item.id,
            body: bodies[item.id] ?? "",
          })),
        });
        if (result.ok) {
          setErrors({});
          setMessage("saved");
          return;
        }
        const fields = result.fields ?? {};
        setErrors(fields);
        // A wrong text in another language: show that language, or the error stays hidden.
        const wrong = ordered.find((item) =>
          fields.templates?.includes(item.id),
        );
        if (wrong) setLanguage(wrong.locale);
        if (result.error !== "invalid") {
          setMessage(
            result.error === "forbidden" ? "forbidden" : "unavailable",
          );
        }
      } catch {
        setMessage("unavailable");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <legend className="px-1 text-base font-semibold">{t.days}</legend>
        <DaysField
          id={`${id}-first`}
          label={t.firstDays}
          hint={t.firstDaysHint}
          error={errors.firstDays ? t.errors.firstDays : null}
          value={firstDays}
          onChange={setFirstDays}
          name="firstDays"
        />
        <DaysField
          id={`${id}-second`}
          label={t.secondDays}
          hint={t.secondDaysHint}
          error={errors.secondDays ? t.errors.secondDays : null}
          value={secondDays}
          onChange={setSecondDays}
          name="secondDays"
        />
        <p className="text-sm text-muted-foreground">{t.lastDayNote}</p>
      </fieldset>

      <section
        aria-labelledby={`${id}-variables`}
        className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm"
      >
        <h2 id={`${id}-variables`} className="text-base font-semibold">
          {t.variablesTitle}
        </h2>
        <dl className="grid gap-1 md:grid-cols-[auto_1fr] md:gap-x-4">
          {Object.entries(t.variables).map(([name, text]) => (
            <div key={name} className="contents">
              <dt className="font-mono">{`{${name}}`}</dt>
              <dd className="mb-1 text-muted-foreground md:mb-0">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby={`${id}-templates`}
        className="flex flex-col gap-4"
      >
        <h2 id={`${id}-templates`} className="text-lg font-semibold">
          {t.templates}
        </h2>
        <p className="text-sm text-muted-foreground">
          {previewName
            ? fmt(t.previewFor, { name: previewName })
            : t.previewNoClient}
        </p>
        <p className="text-sm text-muted-foreground">
          {t.templatesLanguageNote}
        </p>
        <div
          role="group"
          aria-label={t.languages}
          className="flex flex-wrap gap-2"
          data-testid="template-languages"
        >
          {LOCALES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              onClick={() => setLanguage(option)}
              className={buttonVariants({
                variant: language === option ? "default" : "outline",
              })}
              data-testid={`template-language-${option}`}
            >
              <span lang={HTML_LANG[option]}>{LOCALE_NAMES[option]}</span>
              {draftLocales.has(option) ? (
                <span className="text-xs font-normal opacity-80">
                  ({t.draft})
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {draftLocales.has(language) ? (
          <p
            className="rounded-lg bg-status-expiring px-3 py-2 text-sm text-status-expiring-foreground"
            data-testid="template-draft-note"
          >
            {t.draftNote}
          </p>
        ) : null}
        {shown.map((item) => {
          const body = bodies[item.id] ?? "";
          const unknown = unknownVariables(body);
          const fieldId = `${id}-${item.kind}-${item.locale}`;
          const invalid = errors.templates?.includes(item.id) ?? false;
          const unused = item.kind === "before_1" && second === null;
          return (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4"
              data-testid={`template-${item.kind}`}
            >
              <label htmlFor={fieldId} className="text-base font-semibold">
                {kindTitle(r, locale, item.kind, first, second)}
              </label>
              {item.kind === "family" ? (
                <p className="text-sm text-muted-foreground">
                  {t.familyHint}
                  {isDraftTemplate(item) ? (
                    <>
                      {" "}
                      <span
                        className="rounded bg-status-expiring px-1.5 py-0.5 text-xs text-status-expiring-foreground"
                        data-testid="template-family-draft"
                      >
                        {t.draft}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
              <textarea
                id={fieldId}
                lang={HTML_LANG[item.locale]}
                name={`body-${item.kind}-${item.locale}`}
                value={body}
                maxLength={BODY_MAX}
                rows={5}
                onChange={(event) =>
                  setBodies((current) => ({
                    ...current,
                    [item.id]: event.target.value,
                  }))
                }
                aria-invalid={invalid || undefined}
                aria-describedby={`${fieldId}-hint`}
                className={`${inputClassName} h-auto min-h-28 py-2`}
              />
              <p
                id={`${fieldId}-hint`}
                className="text-sm text-muted-foreground"
              >
                {invalid ? (
                  <span className="text-status-expired-foreground">
                    {t.errors.body}
                  </span>
                ) : (
                  t.bodyHint
                )}
                {unused ? ` ${t.unused}` : null}
              </p>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{t.preview}</p>
                <p
                  lang={HTML_LANG[item.locale]}
                  className="rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-line"
                  data-testid="template-preview"
                >
                  <Preview
                    text={renderTemplate(
                      body,
                      item.kind === "family" ? family : values,
                    )}
                    unknown={unknown}
                  />
                </p>
                {unknown.length > 0 ? (
                  <p className="text-sm text-status-expired-foreground">
                    {fmt(t.unknown, { tokens: unknown.join(", ") })}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className={buttonVariants({ size: "lg" })}
          disabled={pending}
        >
          <Save aria-hidden />
          {pending ? t.saving : t.save}
        </button>
        <p
          role="status"
          className={`text-sm ${message === "saved" ? "text-status-active-foreground" : "text-status-expired-foreground"}`}
          data-testid="settings-status"
        >
          {message === "saved"
            ? t.saved
            : message === "forbidden"
              ? t.errors.forbidden
              : message === "unavailable"
                ? t.errors.unavailable
                : null}
        </p>
      </div>
    </form>
  );
}

function DaysField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  name,
}: {
  id: string;
  label: string;
  hint: string;
  error: string | null;
  value: string;
  onChange: (value: string) => void;
  name: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={`${inputClassName} max-w-32`}
      />
      <p
        id={`${id}-hint`}
        className={`text-sm ${error ? "text-status-expired-foreground" : "text-muted-foreground"}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}
