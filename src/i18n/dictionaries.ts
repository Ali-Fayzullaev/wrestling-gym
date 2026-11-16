import "server-only";

import type { Locale } from "@/lib/locale";

import { kk } from "./kk";
import type { Messages } from "./messages";
import { ru } from "./ru";
import { uz } from "./uz";

// Server only: the three dictionaries never reach a browser bundle. Client islands get the
// sections they need from the page (./texts.tsx).
export const DICTIONARIES: Record<Locale, Messages> = { ru, kk, uz };
