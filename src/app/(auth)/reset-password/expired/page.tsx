import type { Metadata } from "next";

import { ru } from "@/i18n/ru";

import { ResetPasswordView } from "../reset-view";

export const metadata: Metadata = {
  title: `${ru.auth.reset.title} | ${ru.app.name}`,
};

// Where /auth/confirm sends an invalid or used link: the same form with an explanation.
export default function ResetLinkExpiredPage() {
  return <ResetPasswordView linkInvalid />;
}
