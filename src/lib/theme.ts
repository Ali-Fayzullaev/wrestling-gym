export const THEME_COOKIE = "theme";
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const DARK_QUERY = "(prefers-color-scheme: dark)";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * Runs in <head> before the first paint. Reading the cookie on the server instead would make every
 * route dynamic, and the sign-in pages must stay fully static (see step 03 notes). It also follows
 * the system theme live while the preference is "system".
 */
export const themeInitScript = `(function(){try{var d=document.documentElement,q=window.matchMedia("${DARK_QUERY}"),m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)(?:;|$)/),p=m?m[1]:"system";function a(){var t=d.getAttribute("data-theme")||"system",k=t==="dark"||(t==="system"&&q.matches);d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light"}d.setAttribute("data-theme",p);a();q.addEventListener("change",a)}catch(e){}})()`;

/** Same rule as the init script, for a choice made on the page. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia(DARK_QUERY).matches);
  root.setAttribute("data-theme", preference);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function themeCookie(preference: ThemePreference): string {
  return `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** The preference the init script applied, read back from <html>. */
export function currentThemePreference(): ThemePreference {
  const value = document.documentElement.getAttribute("data-theme");
  return isThemePreference(value) ? value : "system";
}
