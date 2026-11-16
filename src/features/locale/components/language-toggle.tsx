"use client";

import { useId, useState, useTransition } from "react";

import { useLocale, useText } from "@/i18n/client";
import { DRAFT_LOCALES } from "@/i18n/messages";
import { HTML_LANG, type Locale, LOCALE_NAMES, LOCALES } from "@/lib/locale";

import type { SetLocaleResult } from "../service";

/**
 * Russian / Kazakh / Uzbek, each named in itself, styled like the theme switch. The choice is
 * saved to the employee's profile, then the page loads again in the new language.
 */
export function LanguageToggle({
  save,
}: {
  save: (locale: Locale) => Promise<SetLocaleResult>;
}) {
  const t = useText("language");
  const current = useLocale();
  const [chosen, setChosen] = useState<Locale>(current);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const name = useId();
  const noteId = useId();

  function choose(locale: Locale) {
    setChosen(locale);
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await save(locale);
        if (result.ok) {
          window.location.reload();
          return;
        }
      } catch {
        // Falls through to the message below.
      }
      setChosen(current);
      setFailed(true);
    });
  }

  return (
    <fieldset
      className="flex flex-col gap-2"
      disabled={pending}
      aria-describedby={noteId}
    >
      <legend className="mb-2 text-sm font-medium">{t.label}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {LOCALES.map((option) => (
          <label
            key={option}
            lang={HTML_LANG[option]}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-[3px] has-focus-visible:ring-ring"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={chosen === option}
              onChange={() => choose(option)}
              className="sr-only"
            />
            {LOCALE_NAMES[option]}
          </label>
        ))}
      </div>
      <p
        id={noteId}
        className="text-xs text-muted-foreground"
        aria-live="polite"
      >
        {failed ? (
          <span className="text-destructive">{t.failed}</span>
        ) : DRAFT_LOCALES.includes(current) ? (
          t.draftNote
        ) : null}
      </p>
    </fieldset>
  );
}
