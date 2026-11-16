import "server-only";

import type { MascotMood } from "@/lib/mascot";
import { MASCOT_INLINE } from "@/lib/mascot-inline.generated";

import { Mascot } from "./mascot";

/**
 * The mascot at the top of a screen (sign-in, page headers). The picture travels inside the HTML
 * as a data: address, so it paints with the first response instead of after a second request: on
 * the sign-in page it is the largest element, and a separate file pushed LCP from 0.8 s to 2.8 s.
 * Server only: the inline copies (about 4 KB each) must never reach the browser's JavaScript.
 */
export function FirstScreenMascot({
  mood,
  size,
  className,
}: {
  mood: MascotMood;
  size: number;
  className?: string;
}) {
  return (
    <Mascot
      mood={mood}
      size={size}
      priority
      src={MASCOT_INLINE[mood]}
      className={className}
    />
  );
}
