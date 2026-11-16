"use client";

import { Save } from "lucide-react";
import { type FormEvent, useId, useState, useTransition } from "react";

import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import {
  GYM_NAME_MAX,
  type GymField,
  type GymSettings,
  type GymSettingsResult,
} from "../form-fields";

type Message = "saved" | "unchanged" | "forbidden" | "unavailable" | null;

/** "Settings -> Gym": the name and the WhatsApp number, saved with one button. */
export function GymSettingsForm({
  initial,
  save,
}: {
  initial: GymSettings;
  save: (input: {
    gymName: string;
    gymWhatsapp: string;
  }) => Promise<GymSettingsResult>;
}) {
  const settingsText = useText("settings");
  const t = settingsText.gym;
  const id = useId();
  const [gymName, setGymName] = useState(initial.gymName);
  const [gymWhatsapp, setGymWhatsapp] = useState(initial.gymWhatsapp ?? "");
  const [invalid, setInvalid] = useState<GymField[]>([]);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await save({ gymName, gymWhatsapp });
        if (result.ok) {
          setInvalid([]);
          setMessage(result.changed ? "saved" : "unchanged");
          return;
        }
        setInvalid(result.fields ?? []);
        if (result.error !== "invalid") setMessage(result.error);
      } catch {
        setMessage("unavailable");
      }
    });
  }

  const nameInvalid = invalid.includes("gymName");
  const phoneInvalid = invalid.includes("gymWhatsapp");

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
      aria-label={t.title}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          {t.name}
        </label>
        <input
          id={`${id}-name`}
          name="gymName"
          value={gymName}
          maxLength={GYM_NAME_MAX}
          onChange={(event) => setGymName(event.target.value)}
          aria-invalid={nameInvalid || undefined}
          aria-describedby={`${id}-name-hint`}
          className={inputClassName}
        />
        <p id={`${id}-name-hint`} className="text-sm text-muted-foreground">
          {nameInvalid ? (
            <span className="text-status-expired-foreground">
              {t.errors.gymName}
            </span>
          ) : (
            t.nameHint
          )}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-phone`} className="text-sm font-medium">
          {t.whatsapp}
        </label>
        <input
          id={`${id}-phone`}
          name="gymWhatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={gymWhatsapp}
          onChange={(event) => setGymWhatsapp(event.target.value)}
          aria-invalid={phoneInvalid || undefined}
          aria-describedby={`${id}-phone-hint`}
          className={`${inputClassName} max-w-xs`}
        />
        <p id={`${id}-phone-hint`} className="text-sm text-muted-foreground">
          {phoneInvalid ? (
            <span className="text-status-expired-foreground">
              {t.errors.gymWhatsapp}
            </span>
          ) : (
            t.whatsappHint
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonVariants()} disabled={pending}>
          <Save aria-hidden />
          {pending ? t.saving : t.save}
        </button>
        <p
          role="status"
          data-testid="gym-settings-status"
          className={`text-sm ${message === "saved" || message === "unchanged" ? "text-status-active-foreground" : "text-status-expired-foreground"}`}
        >
          {message === null
            ? null
            : message === "saved" || message === "unchanged"
              ? t[message]
              : t.errors[message]}
        </p>
      </div>
    </form>
  );
}
