/** Interface languages (D-04): Russian, Kazakh and Uzbek in Cyrillic. */
export const LOCALES = ["ru", "kk", "uz"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

/** Cookie that remembers the language for the sign-in page and keeps <html lang> in step. */
export const LOCALE_COOKIE = "locale";

/** Request header the proxy sets from the database or the cookie; never trusted from the browser. */
export const LOCALE_HEADER = "x-app-locale";

/** BCP 47 tags for Intl: Kazakhstan formats for all three, Uzbek in Cyrillic script. */
export const INTL_LOCALE: Record<Locale, string> = {
  ru: "ru-KZ",
  kk: "kk-KZ",
  uz: "uz-Cyrl-UZ",
};

/** Value of <html lang>. */
export const HTML_LANG: Record<Locale, string> = {
  ru: "ru",
  kk: "kk",
  uz: "uz-Cyrl",
};

/** Each language named in itself, for the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ru: "Русский",
  kk: "Қазақша",
  uz: "Ўзбекча",
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * First supported language of an Accept-Language header, by quality then order: "kk-KZ,ru;q=0.8"
 * gives "kk". Uzbek in Latin script ("uz-Latn") is not offered, so it falls through.
 */
export function negotiateLocale(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const [language, ...rest] = tag.split("-");
    if (language === "uz" && rest.includes("latn")) continue;
    if (isLocale(language)) return language;
  }
  return null;
}

/** Language of a guest: the cookie, then the browser's languages, then Russian. */
export function guestLocale(
  cookie: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookie)) return cookie;
  return negotiateLocale(acceptLanguage) ?? DEFAULT_LOCALE;
}

export function localeCookieOptions(nodeEnv: string | undefined) {
  return {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    // Only the server reads it.
    httpOnly: true,
    sameSite: "lax" as const,
    secure: nodeEnv === "production",
  };
}
