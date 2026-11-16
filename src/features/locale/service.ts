import type { Db } from "@/db/client";
import type { Locale } from "@/lib/locale";

export type SetLocaleResult =
  { ok: true } | { ok: false; error: "forbidden" | "unavailable" };

/**
 * The signed-in employee's own interface language. The database function changes the caller's row
 * only and refuses guests, deactivated staff and temporary passwords.
 */
export async function setMyLocale(
  db: Db,
  locale: Locale,
): Promise<SetLocaleResult> {
  const { error } = await db.rpc("set_my_locale", { p_locale: locale });
  if (!error) return { ok: true };
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "unavailable" };
}
