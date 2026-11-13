"use client";

import { useEffect } from "react";

/**
 * Loads `href` as a new document once it is set. Used when the signed-in employee changes: a full
 * load leaves nothing of the previous session in the router's memory (menu, cached screens, the
 * Back button), which matters on a phone shared by the front desk.
 */
export function useHardNavigation(href: string | null): void {
  useEffect(() => {
    if (href) window.location.assign(href);
  }, [href]);
}
