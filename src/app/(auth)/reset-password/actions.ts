"use server";

import { headers } from "next/headers";

import { createAdminDb } from "@/db/admin";
import { createServerDb } from "@/db/server";
import { passwordResetRequestSchema } from "@/features/auth/schema";
import { requestPasswordReset } from "@/features/auth/service";
import { ru } from "@/i18n/ru";
import { clientIp } from "@/lib/client-ip";

import type { FormState } from "../form-state";

// Open to guests by design (forgotten password). Limited per email and per IP in the service.
export async function requestPasswordResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const typedEmail = String(formData.get("email") ?? "").slice(0, 254);
  const parsed = passwordResetRequestSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      error: ru.auth.reset.invalidEmail,
      notice: null,
      email: typedEmail,
      redirectTo: null,
    };
  }

  const requestHeaders = await headers();
  // Next has already checked that Origin matches Host for this Server Action; Supabase Auth
  // additionally accepts only redirect URLs from its allow list.
  const origin =
    requestHeaders.get("origin") ?? `https://${requestHeaders.get("host")}`;
  const result = await requestPasswordReset(
    { db: await createServerDb(), admin: createAdminDb() },
    new Date(),
    {
      email: parsed.data.email,
      ip: clientIp(requestHeaders),
      redirectTo: `${origin}/auth/confirm`,
    },
  );
  if (!result.ok) {
    const error =
      result.error === "rate_limited"
        ? ru.auth.tooManyAttempts(result.retryAfterMinutes)
        : ru.auth.unavailable;
    return { error, notice: null, email: typedEmail, redirectTo: null };
  }
  return {
    error: null,
    notice: ru.auth.reset.sent,
    email: "",
    redirectTo: null,
  };
}
