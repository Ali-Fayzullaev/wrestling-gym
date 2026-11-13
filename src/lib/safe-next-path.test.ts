import { describe, expect, it } from "vitest";

import { nextPathFromReferer, safeNextPath } from "./safe-next-path";

const FALLBACK = "/today";

describe("safeNextPath", () => {
  it.each([
    ["/clients", "/clients"],
    [
      "/clients?group=10000000-0000-4000-8000-000000000001",
      "/clients?group=10000000-0000-4000-8000-000000000001",
    ],
    ["/settings/staff#top", "/settings/staff#top"],
    ["/", "/"],
  ])("keeps the internal path %s", (raw, expected) => {
    expect(safeNextPath(raw, FALLBACK)).toBe(expected);
  });

  it.each([
    "https://evil.example/today",
    "http:/evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
    "today",
    "",
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw, FALLBACK)).toBe(FALLBACK);
  });

  it.each([undefined, null, 42, ["/clients"]])(
    "rejects non-string %j",
    (raw) => {
      expect(safeNextPath(raw, FALLBACK)).toBe(FALLBACK);
    },
  );

  it("normalises dot segments without leaving the site", () => {
    expect(safeNextPath("/../../etc", FALLBACK)).toBe("/etc");
  });
});

describe("nextPathFromReferer", () => {
  it("takes next from the sign-in page address", () => {
    expect(
      nextPathFromReferer(
        "http://127.0.0.1:3100/login?next=%2Fclients",
        FALLBACK,
      ),
    ).toBe("/clients");
  });

  it("still refuses an external next", () => {
    expect(
      nextPathFromReferer(
        "http://127.0.0.1:3100/login?next=%2F%2Fevil.example",
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });

  it.each([null, "", "not a url", "http://127.0.0.1:3100/login"])(
    "falls back for %j",
    (referer) => {
      expect(nextPathFromReferer(referer, FALLBACK)).toBe(FALLBACK);
    },
  );
});
