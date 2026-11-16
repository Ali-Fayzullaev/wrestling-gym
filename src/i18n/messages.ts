import type { Locale } from "@/lib/locale";

import type { Plural, PluralCategory } from "./format";
import type { ru } from "./ru";

type IsPlural<T> = T extends { readonly other: string }
  ? Exclude<keyof T, PluralCategory | "other"> extends never
    ? true
    : false
  : false;

/** The shape of `ru` with every text widened to string, so kk.ts and uz.ts can fill it. */
type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : IsPlural<T> extends true
      ? Plural
      : { readonly [K in keyof T]: Widen<T[K]> };

/** A dictionary: a missing key in kk.ts or uz.ts fails `tsc`. */
export type Messages = Widen<typeof ru>;

/** Texts and language of one request, as Server Components and actions receive them. */
export type I18n = { t: Messages; locale: Locale };

/** Top-level sections; a page hands its client islands only the sections they read. */
export type Namespace = keyof Messages;

/**
 * Translations still waiting for a native speaker to proofread them (D-13, item 3). The language
 * switcher says so under the choice.
 */
export const DRAFT_LOCALES: readonly Locale[] = ["kk", "uz"];

export function pickMessages<N extends Namespace>(
  messages: Messages,
  namespaces: readonly N[],
): Pick<Messages, N> {
  const picked: Partial<Pick<Messages, N>> = {};
  for (const ns of namespaces) picked[ns] = messages[ns];
  return picked as Pick<Messages, N>;
}
