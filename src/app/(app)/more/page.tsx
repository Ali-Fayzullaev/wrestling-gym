import { ChartColumn, ChevronRight, ScrollText, UserCog } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";

import { NAV_PATHS } from "../_nav/nav-paths";
import { LogoutButton } from "../logout-button";

export const metadata: Metadata = {
  title: `${ru.pages.more} | ${ru.app.name}`,
};

const OWNER_LINKS = [
  { key: "reports", icon: ChartColumn },
  { key: "audit", icon: ScrollText },
  { key: "staff", icon: UserCog },
] as const;

/** On a phone, everything that does not fit the bottom menu: owner sections, theme, sign-out. */
export default async function MorePage() {
  const actor = await requireStaff(STAFF_ROLES);
  return (
    <>
      <PageHeader title={ru.pages.more} />
      {actor.role === "owner" ? (
        <section
          aria-labelledby="owner-sections"
          className="flex flex-col gap-2"
        >
          <h2
            id="owner-sections"
            className="text-sm font-medium text-muted-foreground"
          >
            {ru.pages.ownerSections}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {OWNER_LINKS.map(({ key, icon: Icon }) => (
              <li key={key}>
                <Link
                  href={NAV_PATHS[key]}
                  className="flex min-h-12 items-center gap-3 px-4 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <Icon aria-hidden className="size-5 text-muted-foreground" />
                  <span className="flex-1">{ru.nav[key]}</span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
