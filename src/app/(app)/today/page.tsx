import type { Metadata } from "next";

import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";

import { PlaceholderPage } from "../placeholder-page";

export const metadata: Metadata = {
  title: `${ru.pages.today} | ${ru.app.name}`,
};

export default async function TodayPage() {
  const actor = await requireStaff(STAFF_ROLES);
  return <PlaceholderPage title={ru.pages.today} actor={actor} />;
}
