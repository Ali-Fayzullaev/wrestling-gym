/** Every mood the mascot has; each is a file public/mascot/<mood>.svg (scripts/mascot/build.mts). */
export const MASCOT_MOODS = [
  "hello",
  "ok",
  "champion",
  "search",
  "oops",
  "stop",
  "lost",
  "focus",
] as const;

export type MascotMood = (typeof MASCOT_MOODS)[number];

/** Address of a mood's picture; a static file, so the browser caches it across pages. */
export function mascotSrc(mood: MascotMood): string {
  return `/mascot/${mood}.svg`;
}
