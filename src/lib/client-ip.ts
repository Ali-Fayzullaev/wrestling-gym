type HeaderReader = { get(name: string): string | null };

/**
 * Client address for rate limiting. On Vercel `x-forwarded-for` is set by the platform and
 * client-supplied values are overwritten, so its first entry is the real client. Without a
 * trusted proxy in front the header is spoofable; deploy only behind Vercel (see step 13).
 */
export function clientIp(headers: HeaderReader): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}
