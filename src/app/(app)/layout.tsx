import { Suspense } from "react";

import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";

import { BottomNav, SideNav } from "./_nav/app-nav";
import { LogoutButton } from "./logout-button";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-[3px] focus:ring-ring"
      >
        {ru.nav.skipToContent}
      </a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-sidebar py-5 text-sidebar-foreground md:flex">
        {/* STUB(D-01): text logo until the gym's name and logo are decided. */}
        <p className="px-6 text-base font-semibold tracking-tight">
          {ru.app.name}
        </p>
        <Suspense fallback={<SideNav isOwner={false} />}>
          <RoleAwareSideNav />
        </Suspense>
        <div className="border-t px-3 pt-3">
          <LogoutButton />
        </div>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1200px] min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] outline-none md:px-8 md:pt-8 md:pb-10"
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

async function RoleAwareSideNav() {
  const actor = await requireStaff(STAFF_ROLES);
  return <SideNav isOwner={actor.role === "owner"} />;
}
