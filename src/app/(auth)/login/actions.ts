"use server";

import { headers } from "next/headers";

import { createAdminDb } from "@/db/admin";
import { createServerDb } from "@/db/server";
import { HOME_PATH } from "@/features/auth/routes";
import { signInSchema } from "@/features/auth/schema";
import { signIn, type SignInResult } from "@/features/auth/service";
import { ru } from "@/i18n/ru";
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
  if (!parsed.success) {
    return {
      error: ru.auth.login.invalidCredentials,
      notice: null,
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
      error: signInErrorText(result),
      notice: null,
      email: typedEmail,
      redirectTo: null,
    };

  return {
    error: null,
    notice: null,
    email: "",
    redirectTo: nextPathFromReferer(requestHeaders.get("referer"), HOME_PATH),
  };
}

function signInErrorText(result: Extract<SignInResult, { ok: false }>): string {
  switch (result.error) {
    case "invalid_credentials":
      return ru.auth.login.invalidCredentials;
    case "rate_limited":
      return ru.auth.tooManyAttempts(result.retryAfterMinutes ?? 15);
    case "access_disabled":
      return ru.auth.login.accessDisabled;
    case "unavailable":
      return ru.auth.unavailable;
  }
}
