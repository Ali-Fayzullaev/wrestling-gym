import type { Metadata } from "next";

import { ru } from "@/i18n/ru";

import { ResetPasswordView } from "./reset-view";

export const metadata: Metadata = {
  title: `${ru.auth.reset.title} | ${ru.app.name}`,
};

export default function ResetPasswordPage() {
  return <ResetPasswordView linkInvalid={false} />;
}
