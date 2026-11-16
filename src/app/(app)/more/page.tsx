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
import { LanguageToggle } from "@/features/locale/components/language-toggle";
import type { Messages } from "@/i18n/messages";
import { getI18n } from "@/i18n/server";

import { NAV_PATHS, type NavKey } from "../_nav/nav-paths";
import { LogoutButton } from "../logout-button";
import { setLocaleAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.more} | ${t.app.name}` };
}

type SectionLink = { href: string; label: string; icon: LucideIcon };

function navLink(t: Messages, key: NavKey, icon: LucideIcon): SectionLink {
  return { href: NAV_PATHS[key], label: t.nav[key], icon };
}

function workLinks(t: Messages): SectionLink[] {
  return [navLink(t, "reminders", BellRing)];
}

// Reminder settings and staff live inside "Settings". The import is reached from here and from
// the clients list, not from the side menu.
function ownerLinks(t: Messages): SectionLink[] {
  return [
    navLink(t, "reports", ChartColumn),
    navLink(t, "audit", ScrollText),
    navLink(t, "settings", Settings),
    { href: "/clients/import", label: t.pages.clientImport, icon: Upload },
  ];
}

/**
 * On a phone, everything that does not fit the bottom menu: reminders, owner sections, theme,
 * language, sign-out. On a computer the language is chosen here too (the owner asked for this
 * place, under the theme).
 */
export default async function MorePage() {
  const actor = await requireStaff(STAFF_ROLES);
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={t.pages.more} />
      <LinkSection
        id="work-sections"
        title={t.pages.workSections}
        links={workLinks(t)}
      />
      {actor.role === "owner" ? (
        <LinkSection
          id="owner-sections"
          title={t.pages.ownerSections}
          links={ownerLinks(t)}
        />
      ) : null}
      <section className="flex flex-col gap-6 rounded-xl border bg-card p-4">
        <ThemeToggle />
        <LanguageToggle save={setLocaleAction} />
      </section>
      <section aria-labelledby="account" className="flex flex-col gap-2">
        <h2 id="account" className="text-sm font-medium text-muted-foreground">
          {t.pages.account}
        </h2>
        <div className="flex flex-col gap-1 rounded-xl border bg-card p-2">
          <p className="px-3 pt-2 text-sm" data-testid="actor-role">
            {t.roles[actor.role]}
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
