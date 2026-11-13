import { describe, expect, it } from "vitest";

import { isThemePreference, themeCookie, themeInitScript } from "./theme";

type FakeRoot = {
  attributes: Map<string, string>;
  classes: Set<string>;
  style: { colorScheme: string };
};

/** Runs the inline script against a minimal stand-in for the browser globals it touches. */
function runInitScript(cookie: string, systemDark: boolean) {
  const root: FakeRoot = {
    attributes: new Map(),
    classes: new Set(),
    style: { colorScheme: "" },
  };
  const listeners: (() => void)[] = [];
  const query = {
    matches: systemDark,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.push(listener),
  };
  const document = {
    cookie,
    documentElement: {
      style: root.style,
      getAttribute: (name: string) => root.attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) =>
        root.attributes.set(name, value),
      classList: {
        toggle: (name: string, force: boolean) => {
          if (force) root.classes.add(name);
          else root.classes.delete(name);
        },
      },
    },
  };
  const window = { matchMedia: () => query };
  new Function("document", "window", themeInitScript)(document, window);
  return {
    root,
    changeSystem(dark: boolean) {
      query.matches = dark;
      for (const listener of listeners) listener();
    },
  };
}

describe("themeInitScript", () => {
  it.each([
    ["theme=dark", false, true],
    ["theme=light", true, false],
    ["theme=system", true, true],
    ["theme=system", false, false],
    ["", true, true],
    ["", false, false],
    ["sb-auth=x; theme=dark; other=1", false, true],
    ["theme=purple", false, false],
    ["mytheme=dark", false, false],
  ])("cookie %j, system dark %s -> dark %s", (cookie, systemDark, dark) => {
    const { root } = runInitScript(cookie, systemDark);
    expect(root.classes.has("dark")).toBe(dark);
    expect(root.style.colorScheme).toBe(dark ? "dark" : "light");
  });

  it("follows the system theme live only while the choice is system", () => {
    const system = runInitScript("theme=system", false);
    system.changeSystem(true);
    expect(system.root.classes.has("dark")).toBe(true);

    const fixed = runInitScript("theme=light", false);
    fixed.changeSystem(true);
    expect(fixed.root.classes.has("dark")).toBe(false);
  });
});

describe("theme preference", () => {
  it("accepts only the three known values", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("is stored for a year on every path", () => {
    expect(themeCookie("dark")).toBe(
      "theme=dark; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});
