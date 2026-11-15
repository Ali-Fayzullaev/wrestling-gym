import {
  BellRing,
  ChartColumn,
  ChevronRight,
  type LucideIcon,
  ScrollText,
  Settings,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";

import { NAV_PATHS, type NavKey } from "../_nav/nav-paths";
import { LogoutButton } from "../logout-button";

export const metadata: Metadata = {
  title: `${ru.pages.more} | ${ru.app.name}`,
};

type SectionLink = { href: string; label: string; icon: LucideIcon };

const navLink = (key: NavKey, icon: LucideIcon): SectionLink => ({
  href: NAV_PATHS[key],
  label: ru.nav[key],
  icon,
});

const WORK_LINKS: SectionLink[] = [navLink("reminders", BellRing)];

// Reminder settings and staff live inside "Settings". The import is reached from here and from
// the clients list, not from the side menu.
const OWNER_LINKS: SectionLink[] = [
  navLink("reports", ChartColumn),
  navLink("audit", ScrollText),
  navLink("settings", Settings),
  { href: "/clients/import", label: ru.pages.clientImport, icon: Upload },
];

/**
 * On a phone, everything that does not fit the bottom menu: reminders, owner sections, theme,
 * sign-out.
 */
export default async function MorePage() {
  const actor = await requireStaff(STAFF_ROLES);
  return (
    <>
      <PageHeader title={ru.pages.more} />
      <LinkSection
        id="work-sections"
        title={ru.pages.workSections}
        links={WORK_LINKS}
      />
      {actor.role === "owner" ? (
        <LinkSection
          id="owner-sections"
          title={ru.pages.ownerSections}
          links={OWNER_LINKS}
        />
      ) : null}
      <section className="rounded-xl border bg-card p-4">
        <ThemeToggle />
      </section>
      <section aria-labelledby="account" className="flex flex-col gap-2">
        <h2 id="account" className="text-sm font-medium text-muted-foreground">
          {ru.pages.account}
        </h2>
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-2">
          <p className="px-3 pt-2 text-sm" data-testid="actor-role">
            {ru.roles[actor.role]}
          </p>
          <LogoutButton />
        </div>
      </section>
    </>
  );
}

function LinkSection({
  id,
  title,
  links,
}: {
  id: string;
  title: string;
  links: SectionLink[];
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {links.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Icon aria-hidden className="size-5 text-muted-foreground" />
              <span className="flex-1">{label}</span>
              <ChevronRight
                aria-hidden
                className="size-4 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
