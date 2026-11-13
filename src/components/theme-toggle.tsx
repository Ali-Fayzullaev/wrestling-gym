"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { ru } from "@/i18n/ru";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Light / dark / system as native radio buttons: arrow keys move between them. Classes are joined
 * by hand: cn() would bring the class-merge engine (~9 KB) into the screen's first load.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const name = useId();

  return (
    <fieldset className={`flex flex-col gap-2 ${className ?? ""}`}>
      <legend className="mb-2 text-sm font-medium">{ru.theme.label}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {THEME_PREFERENCES.map((option: ThemePreference) => {
          const Icon = ICONS[option];
          return (
            <label
              key={option}
              className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-[3px] has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={preference === option}
                onChange={() => setPreference(option)}
                className="sr-only"
              />
              <Icon aria-hidden className="size-4" />
              {ru.theme[option]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
