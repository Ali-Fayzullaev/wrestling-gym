import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MASCOT_MOODS, mascotSrc } from "./mascot";
import { MASCOT_INLINE } from "./mascot-inline.generated";

// The pictures are served as static files from public/; these tests keep them small, safe and
// calm for people who asked their phone for less motion.
const MAX_BYTES = 8 * 1024;

async function readMood(mood: (typeof MASCOT_MOODS)[number]): Promise<string> {
  return readFile(
    new URL(`../../public${mascotSrc(mood)}`, import.meta.url),
    "utf8",
  );
}

describe("mascot pictures", () => {
  it.each(MASCOT_MOODS)(
    "%s exists, is a square SVG and stays under 8 KB",
    async (mood) => {
      const svg = await readMood(mood);
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg).toContain('viewBox="0 0 160 160"');
      expect(Buffer.byteLength(svg)).toBeLessThan(MAX_BYTES);
    },
  );

  it.each(MASCOT_MOODS)(
    "%s has no script, no event handler and no outside address",
    async (mood) => {
      const svg = await readMood(mood);
      expect(svg).not.toMatch(/<script|\son\w+=|href=|@import|url\((?!#)/i);
      // The only address allowed is the SVG namespace itself.
      expect(svg.match(/https?:\/\/[^"\s]+/g)).toEqual([
        "http://www.w3.org/2000/svg",
      ]);
    },
  );

  it.each(MASCOT_MOODS)(
    "%s stops moving when reduced motion is asked for",
    async (mood) => {
      const svg = await readMood(mood);
      expect(svg).toContain(
        "@media (prefers-reduced-motion:reduce){*{animation:none!important}}",
      );
    },
  );

  it("every mood has its own picture", async () => {
    const files = await Promise.all(MASCOT_MOODS.map(readMood));
    expect(new Set(files).size).toBe(MASCOT_MOODS.length);
  });

  it.each(MASCOT_MOODS)(
    "%s inline copy for the first screen is the same picture as the file",
    async (mood) => {
      const file = await readMood(mood);
      const inline = decodeURIComponent(
        MASCOT_INLINE[mood].replace("data:image/svg+xml,", ""),
      );
      expect(inline).toBe(file.replace(/\n/g, "").replaceAll('"', "'"));
    },
  );
});
