const PLACEHOLDER_ORIGIN = "http://internal.invalid";

/**
 * Returns `raw` only when it is a path on this site, otherwise `fallback`. Guards the
 * "return to the page you came from" redirect after sign-in against open redirects
 * (`//evil.example`, `/\evil.example`, `https://...`, `javascript:`).
 */
export function safeNextPath(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return fallback;
  // Browsers treat a backslash like a slash, so "/\evil.example" is protocol-relative too.
  if (raw.startsWith("//") || raw.includes("\\")) return fallback;
  // Control characters (tab, newline) are stripped by URL parsers and can hide a second slash.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The sign-in page keeps the return address in its own URL (`/login?next=...`). The form action
 * reads it from the Referer header, so the page stays fully static and also works when submitted
 * before hydration. A missing or foreign Referer simply leads to `fallback`.
 */
export function nextPathFromReferer(
  referer: string | null,
  fallback: string,
): string {
  if (!referer) return fallback;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return fallback;
  }
  return safeNextPath(url.searchParams.get("next"), fallback);
}
