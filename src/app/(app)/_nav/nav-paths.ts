export const NAV_PATHS = {
  today: "/today",
  clients: "/clients",
  groups: "/groups",
  reminders: "/reminders",
  more: "/more",
  reports: "/reports",
  audit: "/audit",
  settings: "/settings",
} as const;

export type NavKey = keyof typeof NAV_PATHS;

/** The four places a phone menu has room for. */
export const BOTTOM_NAV: readonly NavKey[] = [
  "today",
  "clients",
  "groups",
  "more",
];
/** Side menu on a computer: everything an employee may open, owner sections only for the owner. */
export const SIDE_NAV: readonly NavKey[] = [
  "today",
  "clients",
  "groups",
  "reminders",
];
export const OWNER_NAV: readonly NavKey[] = ["reports", "audit", "settings"];
/** Bottom of the side menu: theme and sign-out live on the "More" screen, as on a phone. */
export const SIDE_FOOTER_NAV: readonly NavKey[] = ["more"];

function within(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Which menu item is current. On a phone, sections reached through "More" (owner pages, settings)
 * pass `fallback: "more"`, so the bottom menu always shows where the employee is.
 */
export function activeNavKey(
  pathname: string,
  items: readonly NavKey[],
  fallback: NavKey | null = null,
): NavKey | null {
  return items.find((key) => within(pathname, NAV_PATHS[key])) ?? fallback;
}
