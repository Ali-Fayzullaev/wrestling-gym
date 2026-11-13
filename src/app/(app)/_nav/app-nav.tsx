"use client";

import {
  CalendarCheck,
  ChartColumn,
  Ellipsis,
  type LucideIcon,
  ScrollText,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ru } from "@/i18n/ru";

import {
  activeNavKey,
  BOTTOM_NAV,
  NAV_PATHS,
  type NavKey,
  OWNER_NAV,
  SIDE_FOOTER_NAV,
  SIDE_NAV,
} from "./nav-paths";

const ICONS: Record<NavKey, LucideIcon> = {
  today: CalendarCheck,
  clients: Users,
  groups: UsersRound,
  more: Ellipsis,
  reports: ChartColumn,
  audit: ScrollText,
  staff: UserCog,
};

// Class names are joined by hand, not with cn(): the merge engine would add ~9 KB to every
// screen's first load, and these strings never conflict.

/** Fixed to the bottom of a phone screen, above the home bar; hidden from md up. */
export function BottomNav() {
  const active = activeNavKey(usePathname(), BOTTOM_NAV, "more");
  return (
    <nav
      aria-label={ru.nav.label}
      data-slot="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
    >
      <ul className="grid grid-cols-4">
        {BOTTOM_NAV.map((key) => {
          const Icon = ICONS[key];
          const current = key === active;
          return (
            <li key={key}>
              <Link
                href={NAV_PATHS[key]}
                aria-current={current ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset ${current ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span
                  aria-hidden
                  className={`absolute inset-x-6 top-0 h-0.5 rounded-b-full ${current ? "bg-primary" : "bg-transparent"}`}
                />
                <Icon
                  aria-hidden
                  className="size-6"
                  strokeWidth={current ? 2.25 : 1.75}
                />
                {ru.nav[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Side menu on a computer; owner sections are passed in once the role is known. */
export function SideNav({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={ru.nav.label} className="flex flex-1 flex-col gap-4 px-3">
      <SideNavList items={SIDE_NAV} active={activeNavKey(pathname, SIDE_NAV)} />
      {isOwner ? (
        <SideNavList
          items={OWNER_NAV}
          active={activeNavKey(pathname, OWNER_NAV)}
          heading={ru.pages.ownerSections}
        />
      ) : null}
      <div className="mt-auto">
        <SideNavList
          items={SIDE_FOOTER_NAV}
          active={activeNavKey(pathname, SIDE_FOOTER_NAV)}
        />
      </div>
    </nav>
  );
}

function SideNavList({
  items,
  active,
  heading,
}: {
  items: readonly NavKey[];
  active: NavKey | null;
  heading?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {heading ? (
        <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
          {heading}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {items.map((key) => {
          const Icon = ICONS[key];
          const current = key === active;
          return (
            <li key={key}>
              <Link
                href={NAV_PATHS[key]}
                aria-current={current ? "page" : undefined}
                className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring ${
                  current
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-2 left-0 w-1 rounded-r-full ${current ? "bg-sidebar-primary" : "bg-transparent"}`}
                />
                <Icon aria-hidden className="size-5" />
                {ru.nav[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
