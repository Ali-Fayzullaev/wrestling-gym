import type { Metadata } from "next";

import { requireStaff } from "@/features/auth/require-staff";
import { ru } from "@/i18n/ru";

import { PlaceholderPage } from "../placeholder-page";

export const metadata: Metadata = {
  title: `${ru.pages.reports} | ${ru.app.name}`,
};

export default async function ReportsPage() {
  const actor = await requireStaff(["owner"]);
  return <PlaceholderPage title={ru.pages.reports} actor={actor} />;
}
