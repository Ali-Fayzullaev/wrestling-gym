"use client";

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

import {
  applyThemePreference,
  currentThemePreference,
  type ThemePreference,
  themeCookie,
} from "./theme";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The theme preference the head script applied (null during server render and hydration, when it
 * is not known yet), and a setter that applies and remembers a new one.
 */
export function useTheme(): {
  preference: ThemePreference | null;
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(
    subscribe,
    currentThemePreference,
    () => null,
  );

  // Dev-only: Strict Mode's remount resets <html> attributes the head script set. No-op in prod.
  useLayoutEffect(() => {
    applyThemePreference(currentThemePreference());
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    document.cookie = themeCookie(next);
    applyThemePreference(next);
    for (const listener of listeners) listener();
  }, []);

  return { preference, setPreference };
}
