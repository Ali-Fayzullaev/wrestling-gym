import { ChevronLeft } from "lucide-react";
import Link from "next/link";

/** "‹ Clients" (or another parent screen) above a client screen's title. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-mb-3 flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <ChevronLeft aria-hidden className="size-4" />
      {label}
    </Link>
  );
}
