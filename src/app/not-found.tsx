import type { Metadata } from "next";
import Link from "next/link";

import { FirstScreenMascot } from "@/components/first-screen-mascot";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.notFound.title} | ${t.app.name}` };
}

/** A wrong or outdated address: the mascot shrugs, one link leads back to work. */
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <FirstScreenMascot mood="lost" size={144} />
      <h1 className="text-2xl font-semibold tracking-tight">
        {t.notFound.title}
      </h1>
      <p className="text-muted-foreground">{t.notFound.text}</p>
      <Link
        href="/today"
        className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {t.notFound.back}
      </Link>
    </main>
  );
}
