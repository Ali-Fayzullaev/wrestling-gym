import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { LOCALE_HEADER, type Locale, parseLocale } from "@/lib/locale";

import { DICTIONARIES } from "./dictionaries";
import type { I18n } from "./messages";

/**
 * Language of this request. The proxy sets the header on every request, from the employee's
 * profile or, for a guest, from the cookie or Accept-Language, overwriting anything the browser
 * sent; so no page waits for its own database lookup.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  return parseLocale((await headers()).get(LOCALE_HEADER));
});

/** Texts of this request's language, for Server Components, Server Actions and route handlers. */
export async function getI18n(): Promise<I18n> {
  const locale = await getLocale();
  return { locale, t: DICTIONARIES[locale] };
}
