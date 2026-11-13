"use client";

import { type ComponentType, useEffect, useState } from "react";

const AFTER_LOAD_MS = 1500;

/** Set while a DeferredToaster is mounted: loads the toast area right away. */
let loadNow: (() => void) | null = null;

/**
 * Called by a dialog that will show a toast (they load lazily, on first intent): the toast area
 * is mounted before the dialog can finish, however quickly the person is.
 */
export function requestToaster(): void {
  loadNow?.();
}

/**
 * Mounts the toast area a moment after the page has loaded, when the browser is idle, or as soon
 * as a dialog asks for it. Either way sonner (~10 KB) is not part of the screen's first load,
 * streamed screens included. Place it in the layout of screens that show toasts; it stays mounted
 * across their navigations, so a toast survives a redirect to a sibling screen.
 */
export function DeferredToaster() {
  const [Toaster, setToaster] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    let started = false;
    let timer: number | undefined;
    const load = () => {
      if (started) return;
      started = true;
      void import("@/components/ui/sonner").then((module) => {
        if (!cancelled) setToaster(() => module.Toaster);
      });
    };
    // Safari has no requestIdleCallback.
    const hasIdle = typeof window.requestIdleCallback === "function";
    const whenIdle = () =>
      hasIdle ? window.requestIdleCallback(load, { timeout: 2000 }) : load();
    const afterLoad = () => {
      timer = window.setTimeout(whenIdle, AFTER_LOAD_MS);
    };

    loadNow = load;
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      cancelled = true;
      if (loadNow === load) loadNow = null;
      window.clearTimeout(timer);
      window.removeEventListener("load", afterLoad);
    };
  }, []);

  return Toaster ? <Toaster /> : null;
}
