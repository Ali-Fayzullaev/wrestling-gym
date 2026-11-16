"use server";

import { cookies } from "next/headers";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { localeSchema } from "@/features/locale/schema";
import { type SetLocaleResult, setMyLocale } from "@/features/locale/service";
import { LOCALE_COOKIE, localeCookieOptions } from "@/lib/locale";

/**
 * Any employee: their own language. The page reloads afterwards; the proxy then reads the new
 * language from the profile, so nothing here re-renders.
 */
export async function setLocaleAction(raw: unknown): Promise<SetLocaleResult> {
  await requireStaff(STAFF_ROLES);
  const parsed = localeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "unavailable" };
  const result = await setMyLocale(await createServerDb(), parsed.data);
  if (result.ok) {
    (await cookies()).set(
      LOCALE_COOKIE,
      parsed.data,
      localeCookieOptions(process.env.NODE_ENV),
    );
  }
  return result;
}
