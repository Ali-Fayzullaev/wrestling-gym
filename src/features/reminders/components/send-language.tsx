"use client";

import { useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { fmt } from "@/i18n/format";
import { HTML_LANG, type Locale, LOCALE_NAMES, LOCALES } from "@/lib/locale";

import type { ReminderTargetInput } from "../result";
import type { ReminderMessage, ReminderVariant } from "../service";
import {
  type OpenReminder,
  type WhatsAppLabels,
  WhatsAppButton,
} from "./whatsapp-button";

export type SendLanguageLabels = {
  /** Name of the switch for screen readers: "Язык сообщения". */
  label: string;
  /** "Сообщение на: {language}". */
  sendingIn: string;
  draft: string;
  hint: string;
  showText: string;
};

/**
 * "Message in: Ўзбекча" (the language the text is really in, Russian when the chosen one has no
 * text), a "draft" mark for an unedited translation, and the three-language switch.
 */
export function SendLanguagePicker({
  locale,
  variant,
  onChange,
  labels,
}: {
  locale: Locale;
  variant: ReminderVariant;
  onChange: (locale: Locale) => void;
  labels: SendLanguageLabels;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3">
      <p className="text-sm text-muted-foreground">
        <span data-testid="reminder-language">
          {fmt(labels.sendingIn, { language: LOCALE_NAMES[variant.locale] })}
        </span>
        {variant.draft ? (
          <>
            {" · "}
            <span
              className="rounded bg-status-expiring px-1.5 py-0.5 text-xs text-status-expiring-foreground"
              data-testid="reminder-draft"
            >
              {labels.draft}
            </span>
          </>
        ) : null}
      </p>
      <div
        role="group"
        aria-label={labels.label}
        className="grid grid-cols-3 gap-1 sm:flex"
      >
        {LOCALES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={locale === option}
            onClick={() => onChange(option)}
            // Selected: a frame and bold, not colour alone; red stays for the WhatsApp button.
            className={
              locale === option
                ? `${buttonVariants({ variant: "secondary" })} font-semibold ring-1 ring-foreground/50`
                : buttonVariants({ variant: "ghost" })
            }
          >
            <span lang={HTML_LANG[option]}>{LOCALE_NAMES[option]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The text exactly as it goes into the wa.me link. */
export function ReminderPreview({ variant }: { variant: ReminderVariant }) {
  return (
    <p
      lang={HTML_LANG[variant.locale]}
      className="rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-line"
      data-testid="reminder-preview"
    >
      {variant.text}
    </p>
  );
}

/** The client card: switch, the text, the hint and the WhatsApp button for the chosen language. */
export function ReminderComposer({
  message,
  target,
  labels,
  whatsappLabels,
  hint,
  open,
  buttonVariant = "outline",
}: {
  message: ReminderMessage;
  /** One child's reminder, or one message to a parent about several children (D-18). */
  target: ReminderTargetInput;
  labels: SendLanguageLabels;
  whatsappLabels: WhatsAppLabels;
  /** What the button does, shown under the text. */
  hint: string;
  open: OpenReminder;
  /** The WhatsApp button: outline on the card, filled where sending is the main action. */
  buttonVariant?: "default" | "outline";
}) {
  // The language on the card first (the parent's for a child); another one is for this message
  // only, the card never changes.
  const [locale, setLocale] = useState<Locale>(message.defaultLocale);
  const variant = message.variants[locale];
  return (
    <div className="flex flex-col gap-3" data-testid="reminder-composer">
      <SendLanguagePicker
        locale={locale}
        variant={variant}
        onChange={setLocale}
        labels={labels}
      />
      <ReminderPreview variant={variant} />
      <p className="text-sm text-muted-foreground">
        {hint} {labels.hint}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:w-[17rem]">
        <WhatsAppButton
          href={variant.href}
          target={{ ...target, locale }}
          labels={whatsappLabels}
          open={open}
          variant={buttonVariant}
        />
      </div>
    </div>
  );
}
