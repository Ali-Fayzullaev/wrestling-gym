/**
 * Response headers that protect every page. The CSP carries a fresh nonce per request, so it is
 * set by the proxy; the rest are constant and also go on static files through next.config.
 */

export type CspOptions = {
  nonce: string;
  /** sha256 sources (`'sha256-...'`) of inline scripts that are the same on every request. */
  scriptHashes: readonly string[];
  /** React reconstructs server error stacks with eval in development only. */
  isDev: boolean;
  /** `upgrade-insecure-requests` only over HTTPS: on plain-HTTP localhost it would break assets. */
  isHttps: boolean;
};

export function contentSecurityPolicy(options: CspOptions): string {
  const nonce = `'nonce-${options.nonce}'`;
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced Next.js bootstrap load its chunks; 'self' is the fallback
    // for browsers without CSP3.
    [
      "script-src 'self'",
      nonce,
      ...options.scriptHashes,
      "'strict-dynamic'",
      ...(options.isDev ? ["'unsafe-eval'"] : []),
    ].join(" "),
    // Toasts (sonner) insert their <style> at run time, and React and Radix write style=""
    // attributes; neither can carry a nonce. A nonce here would also disable 'unsafe-inline'.
    // Injected CSS cannot run code; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // No Supabase client runs in the browser: every request goes to our own server.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.isHttps ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** Headers that do not change between requests. */
export const STATIC_SECURITY_HEADERS: readonly {
  key: string;
  value: string;
}[] = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** CSP source for an inline block whose text is known in advance. */
export async function sha256Source(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}
