import { describe, expect, it } from "vitest";

import {
  activeNavKey,
  BOTTOM_NAV,
  OWNER_NAV,
  SIDE_FOOTER_NAV,
  SIDE_NAV,
} from "./nav-paths";

describe("activeNavKey", () => {
  it.each([
    ["/today", "today"],
    ["/clients", "clients"],
    ["/clients/3f1c2a7e-0000-4000-8000-000000000000", "clients"],
    ["/groups", "groups"],
    ["/more", "more"],
    ["/reports", "more"],
    ["/settings/staff", "more"],
  ])("bottom menu: %s -> %s", (pathname, key) => {
    expect(activeNavKey(pathname, BOTTOM_NAV, "more")).toBe(key);
  });

  it("side menu highlights More only on the More screen", () => {
    expect(activeNavKey("/more", SIDE_FOOTER_NAV)).toBe("more");
    expect(activeNavKey("/reports", SIDE_FOOTER_NAV)).toBeNull();
  });

  it("does not treat a shared prefix as the same section", () => {
    expect(activeNavKey("/todayish", SIDE_NAV)).toBeNull();
  });

  it.each([
    ["/reports", "reports"],
    ["/settings/staff", "staff"],
    ["/today", null],
  ])("side menu, owner part: %s -> %s", (pathname, key) => {
    expect(activeNavKey(pathname, OWNER_NAV)).toBe(key);
  });
});
