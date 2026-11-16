"use client";

import { createContext, type ReactNode, use, useMemo } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";

import type { Messages, Namespace } from "./messages";

type I18nValue = { locale: Locale; messages: Partial<Messages> };

const I18nContext = createContext<I18nValue | null>(null);

/** Adds sections of texts for the islands below; nested providers add to the outer ones. */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Partial<Messages>;
  children: ReactNode;
}) {
  const outer = use(I18nContext);
  const value = useMemo(
    () => ({ locale, messages: { ...outer?.messages, ...messages } }),
    [locale, messages, outer],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

/** A section of texts the page provided; a missing one is a wiring bug, so it throws. */
export function useText<N extends Namespace>(ns: N): Messages[N] {
  const section = use(I18nContext)?.messages[ns];
  if (!section) throw new Error(`Texts not provided: ${ns}`);
  return section;
}

export function useLocale(): Locale {
  return use(I18nContext)?.locale ?? DEFAULT_LOCALE;
}
