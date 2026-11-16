"use server";

import { headers } from "next/headers";

import { createAdminDb } from "@/db/admin";
import { createServerDb } from "@/db/server";
import { HOME_PATH, PASSWORD_CHANGE_PATH } from "@/features/auth/routes";
import { signInSchema } from "@/features/auth/schema";
import { signIn, type SignInResult } from "@/features/auth/service";
import { plural } from "@/i18n/format";
import type { Messages } from "@/i18n/messages";
import { getI18n } from "@/i18n/server";
import type { Locale } from "@/lib/locale";
import { clientIp } from "@/lib/client-ip";
import { nextPathFromReferer } from "@/lib/safe-next-path";

import type { FormState } from "../form-state";

// No session or role check here: this is the action that creates the session.
export async function signInAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const typedEmail = String(formData.get("email") ?? "").slice(0, 254);
  const { t, locale } = await getI18n();
  if (!parsed.success) {
    return {
      error: t.auth.login.invalidCredentials,
      email: typedEmail,
      redirectTo: null,
    };
  }

  const requestHeaders = await headers();
  const result = await signIn(
    { db: await createServerDb(), admin: createAdminDb() },
    new Date(),
    {
      email: parsed.data.email,
      password: parsed.data.password,
      ip: clientIp(requestHeaders),
    },
  );
  if (!result.ok)
    return {
      error: signInErrorText(t, locale, result),
      email: typedEmail,
      redirectTo: null,
    };

  return {
    error: null,
    email: "",
    // A temporary password is replaced first; the proxy would send them there anyway.
    redirectTo: result.mustChangePassword
      ? PASSWORD_CHANGE_PATH
      : nextPathFromReferer(requestHeaders.get("referer"), HOME_PATH),
  };
}

function signInErrorText(
  t: Messages,
  locale: Locale,
  result: Extract<SignInResult, { ok: false }>,
): string {
  switch (result.error) {
    case "invalid_credentials":
      return t.auth.login.invalidCredentials;
    case "rate_limited":
      return plural(
        locale,
        t.auth.tooManyAttempts,
        result.retryAfterMinutes ?? 15,
      );
    case "access_disabled":
      return t.auth.login.accessDisabled;
    case "unavailable":
      return t.auth.unavailable;
  }
}
