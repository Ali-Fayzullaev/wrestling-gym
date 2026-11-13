import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Reads the colour tokens straight from globals.css, so a palette change (D-01) cannot skip the
 * check. Contrast is WCAG 2.x: relative luminance from linear sRGB.
 */
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

type Color = { luminance: number; alpha: number };

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${selector} block not found`);
  return css.slice(start, css.indexOf("}", start));
}

function tokens(source: string): Map<string, Color> {
  const result = new Map<string, Color>();
  const pattern =
    /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?\)/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, l, c, h, alphaPercent] = match;
    if (!name || !l || !c || !h) continue;
    result.set(name, {
      luminance: oklchLuminance(Number(l), Number(c), Number(h)),
      alpha: alphaPercent === undefined ? 1 : Number(alphaPercent) / 100,
    });
  }
  return result;
}

function oklchLuminance(l: number, c: number, hDegrees: number): number {
  const h = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const red = clamp(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp);
  const green = clamp(
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
  );
  const blue = clamp(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: Color, second: Color): number {
  const lighter = Math.max(first.luminance, second.luminance);
  const darker = Math.min(first.luminance, second.luminance);
  return (lighter + 0.05) / (darker + 0.05);
}

const light = tokens(block(":root"));
const dark = new Map([...light, ...tokens(block(".dark"))]);

/** [text, background] pairs the components actually render. */
const TEXT_PAIRS = [
  ["foreground", "background"],
  ["foreground", "secondary"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "popover"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["status-active-foreground", "status-active"],
  ["status-expiring-foreground", "status-expiring"],
  ["status-expired-foreground", "status-expired"],
  ["status-none-foreground", "status-none"],
  ["sidebar-foreground", "sidebar"],
  ["muted-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["sidebar-primary-foreground", "sidebar-primary"],
] as const;

/** Focus ring and the active-menu marker are not text: WCAG 1.4.11 asks 3:1. */
const NON_TEXT_PAIRS = [
  ["ring", "background"],
  ["ring", "card"],
  ["sidebar-ring", "sidebar"],
  ["primary", "background"],
  ["primary", "sidebar"],
] as const;

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_name, palette) => {
  function pair(text: string, background: string): number {
    const foreground = palette.get(text);
    const surface = palette.get(background);
    if (!foreground || !surface)
      throw new Error(`token missing: ${text} or ${background}`);
    expect(foreground.alpha, `${text} must be opaque`).toBe(1);
    expect(surface.alpha, `${background} must be opaque`).toBe(1);
    return contrast(foreground, surface);
  }

  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (text, background) => {
    expect(pair(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("%s on %s is at least 3:1", (mark, background) => {
    expect(pair(mark, background)).toBeGreaterThanOrEqual(3);
  });
});

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    const white = { luminance: oklchLuminance(1, 0, 0), alpha: 1 };
    const black = { luminance: oklchLuminance(0, 0, 0), alpha: 1 };
    expect(contrast(white, black)).toBeCloseTo(21, 1);
    // #767676 on white is the classic 4.54:1 boundary; oklch(0.5658 0 0) is that grey.
    const grey = { luminance: oklchLuminance(0.5658, 0, 0), alpha: 1 };
    expect(contrast(grey, white)).toBeCloseTo(4.54, 1);
  });

  it("parses every colour token in both themes", () => {
    expect(light.size).toBeGreaterThanOrEqual(30);
    expect(dark.size).toBe(light.size);
  });
});
