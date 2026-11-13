import type { Metadata } from "next";

import { requireStaff } from "@/features/auth/require-staff";
import { ru } from "@/i18n/ru";

import { PlaceholderPage } from "../../placeholder-page";

export const metadata: Metadata = {
  title: `${ru.pages.staff} | ${ru.app.name}`,
};

export default async function StaffPage() {
  const actor = await requireStaff(["owner"]);
  return <PlaceholderPage title={ru.pages.staff} actor={actor} />;
}
