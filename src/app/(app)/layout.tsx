import Link from "next/link";
import { Suspense } from "react";

import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";

import { LogoutButton } from "./logout-button";

const linkClass =
  "inline-flex min-h-11 items-center px-2 text-sm font-medium hover:underline";

// Temporary chrome so the access rules can be exercised; step 04 replaces the layout.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-2 px-4">
          <Link href="/today" className={linkClass}>
            {ru.nav.today}
          </Link>
          <Link href="/clients" className={linkClass}>
            {ru.nav.clients}
          </Link>
          <Suspense fallback={null}>
            <OwnerLinks />
          </Suspense>
          <LogoutButton />
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
        {children}
      </main>
    </div>
  );
}

async function OwnerLinks() {
  const actor = await requireStaff(STAFF_ROLES);
  if (actor.role !== "owner") return null;
  return (
    <>
      <Link href="/reports" className={linkClass}>
        {ru.nav.reports}
      </Link>
      <Link href="/audit" className={linkClass}>
        {ru.nav.audit}
      </Link>
      <Link href="/settings/staff" className={linkClass}>
        {ru.nav.staff}
      </Link>
    </>
  );
}
