import { Suspense } from "react";

import { Mascot } from "@/components/mascot";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { BottomNav, BottomNavView, SideNav, SideNavView } from "./_nav/app-nav";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { t } = await getI18n();
  return (
    <Texts ns={["nav", "pages", "theme", "language", "status"]}>
      <div className="flex flex-1">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-background px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-[3px] focus:ring-ring"
        >
          {t.nav.skipToContent}
        </a>
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-sidebar py-5 text-sidebar-foreground md:flex">
          {/* STUB(D-01): the mascot and the name stand in for a logo until the gym decides on one. */}
          <p className="flex items-center gap-2.5 px-5 text-base font-semibold tracking-tight">
            <Mascot mood="hello" size={36} />
            {t.app.name}
          </p>
          {/* The menus read the path; on routes with an id it is known only per request. */}
          <Suspense fallback={<SideNavView isOwner={false} pathname={null} />}>
            <RoleAwareSideNav />
          </Suspense>
          <div className="flex flex-col gap-1 border-t px-3 pt-3">
            {/* Who is signed in; the phone shows it on the "More" screen. */}
            <p className="h-5 px-3 text-sm text-muted-foreground">
              <Suspense fallback={null}>
                <SignedInRole />
              </Suspense>
            </p>
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
        <Suspense fallback={<BottomNavView active={null} />}>
          <BottomNav />
        </Suspense>
      </div>
    </Texts>
  );
}

async function RoleAwareSideNav() {
  const actor = await requireStaff(STAFF_ROLES);
  return <SideNav isOwner={actor.role === "owner"} />;
}

async function SignedInRole() {
  const actor = await requireStaff(STAFF_ROLES);
  const { t } = await getI18n();
  return <span data-testid="actor-role">{t.roles[actor.role]}</span>;
}
