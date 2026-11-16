import { describe, expect, it } from "vitest";

import { placeholders, type Plural } from "./format";
import { kk } from "./kk";
import type { Messages } from "./messages";
import { ru } from "./ru";
import { uz } from "./uz";

type Leaf = { path: string; value: string | readonly string[] | Plural };

const PLURAL_KEYS = new Set(["zero", "one", "two", "few", "many", "other"]);

function isPlural(value: object): value is Plural {
  const keys = Object.keys(value);
  return keys.includes("other") && keys.every((key) => PLURAL_KEYS.has(key));
}

/** Every text of a dictionary with its dotted path: strings, string lists and plural forms. */
function leaves(node: unknown, path = ""): Leaf[] {
  if (typeof node === "string" || Array.isArray(node)) {
    return [{ path, value: node as string | readonly string[] }];
  }
  if (typeof node === "object" && node !== null) {
    if (isPlural(node)) return [{ path, value: node }];
    return Object.entries(node).flatMap(([key, child]) =>
      leaves(child, path ? `${path}.${key}` : key),
    );
  }
  throw new Error(`Not a text at ${path}: ${typeof node}`);
}

function strings(value: Leaf["value"]): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return [...value];
  return Object.values(value as Plural).filter(
    (form): form is string => typeof form === "string",
  );
}

const reference = new Map(leaves(ru).map((leaf) => [leaf.path, leaf.value]));
// Emoji and pictographs are banned everywhere (CLAUDE.md, rule 2).
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

describe.each([
  ["kk", kk],
  ["uz", uz],
] as const)("%s dictionary", (_name, dictionary: Messages) => {
  const own = leaves(dictionary);

  it("has every text of ru and nothing else", () => {
    expect(own.map((leaf) => leaf.path).sort()).toEqual(
      [...reference.keys()].sort(),
    );
  });

  it("has no empty texts", () => {
    for (const leaf of own) {
      for (const text of strings(leaf.value)) {
        expect(text.trim(), leaf.path).not.toBe("");
      }
    }
  });

  it("keeps the shape of lists and plural forms", () => {
    for (const leaf of own) {
      const ruValue = reference.get(leaf.path);
      if (Array.isArray(ruValue)) {
        expect(leaf.value, leaf.path).toHaveLength(ruValue.length);
      } else if (typeof ruValue === "object" && ruValue !== null) {
        expect(typeof leaf.value, leaf.path).toBe("object");
        expect(Array.isArray(leaf.value), leaf.path).toBe(false);
      } else {
        expect(typeof leaf.value, leaf.path).toBe("string");
      }
    }
  });

  it("keeps the same {parameters} as ru in every form", () => {
    for (const leaf of own) {
      const expected = new Set(
        strings(reference.get(leaf.path) ?? "").flatMap(placeholders),
      );
      for (const text of strings(leaf.value)) {
        expect(new Set(placeholders(text)), `${leaf.path}: ${text}`).toEqual(
          expected,
        );
      }
    }
  });

  it("is translated, not a copy of ru", () => {
    const same = own.filter(
      (leaf) =>
        JSON.stringify(leaf.value) === JSON.stringify(reference.get(leaf.path)),
    );
    // Brand names and words shared by the languages (WhatsApp, Kaspi, Excel, "Телефон") stay.
    expect(same.length / own.length).toBeLessThan(0.1);
  });

  it("has no emoji", () => {
    for (const leaf of own) {
      for (const text of strings(leaf.value)) {
        expect(PICTOGRAPH.test(text), leaf.path).toBe(false);
      }
    }
  });

  it("keeps template variable names of reminder texts untranslated", () => {
    expect(Object.keys(dictionary.reminders.settings.variables)).toEqual(
      Object.keys(ru.reminders.settings.variables),
    );
    expect(dictionary.settings.gym.nameHint).toContain("{название_зала}");
  });
});

describe("ru dictionary", () => {
  it("has no empty texts and no emoji", () => {
    for (const leaf of leaves(ru)) {
      for (const text of strings(leaf.value)) {
        expect(text.trim(), leaf.path).not.toBe("");
        expect(PICTOGRAPH.test(text), leaf.path).toBe(false);
      }
    }
  });
});
