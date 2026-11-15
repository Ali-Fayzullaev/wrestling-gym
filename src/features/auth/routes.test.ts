import { describe, expect, it } from "vitest";

import { decideNavigation, routeAccess } from "./routes";

describe("routeAccess", () => {
  it.each([
    ["/login", "public"],
    ["/reset-password", "public"],
    ["/auth/confirm", "public"],
    // Ending a session must work without one too (expired cookie): the handler just redirects.
    ["/auth/sign-out", "public"],
    ["/reports", "owner"],
    ["/reports/2026-11", "owner"],
    ["/audit", "owner"],
    ["/settings/staff", "owner"],
    ["/settings/reminders", "owner"],
    ["/clients/import", "owner"],
    ["/clients/import/template", "owner"],
    ["/clients/importer", "staff"],
    ["/clients/new", "staff"],
    ["/settings", "owner"],
    ["/settingsx", "staff"],
    ["/reminders", "staff"],
    ["/reportsx", "staff"],
    ["/today", "staff"],
    ["/clients", "staff"],
    ["/update-password", "staff"],
    ["/loginx", "staff"],
  ] as const)("%s is %s", (pathname, access) => {
    expect(routeAccess(pathname)).toBe(access);
  });
});

describe("decideNavigation", () => {
  const guest = { signedIn: false } as const;
  const owner = { signedIn: true, role: "owner" } as const;
  const admin = { signedIn: true, role: "admin" } as const;
  const inactive = { signedIn: true, role: null } as const;

  it("sends guests to sign-in except on public pages", () => {
    expect(decideNavigation("/clients", guest)).toEqual({ kind: "login" });
    expect(decideNavigation("/reports", guest)).toEqual({ kind: "login" });
    expect(decideNavigation("/login", guest)).toEqual({ kind: "continue" });
    expect(decideNavigation("/auth/confirm", guest)).toEqual({
      kind: "continue",
    });
  });

  it("ends the session of someone who is no longer active staff", () => {
    expect(decideNavigation("/today", inactive)).toEqual({
      kind: "sign-out-and-login",
    });
    expect(decideNavigation("/login", inactive)).toEqual({
      kind: "sign-out-and-continue",
    });
  });

  it("keeps owner pages from admins", () => {
    expect(decideNavigation("/reports", admin)).toEqual({ kind: "forbidden" });
    expect(decideNavigation("/audit", admin)).toEqual({ kind: "forbidden" });
    expect(decideNavigation("/settings/staff", admin)).toEqual({
      kind: "forbidden",
    });
    expect(decideNavigation("/reports", owner)).toEqual({ kind: "continue" });
  });

  it("lets staff through to staff pages and sends them home from sign-in", () => {
    expect(decideNavigation("/clients", admin)).toEqual({ kind: "continue" });
    expect(decideNavigation("/login", owner)).toEqual({ kind: "home" });
    expect(decideNavigation("/reset-password", admin)).toEqual({
      kind: "home",
    });
    expect(decideNavigation("/auth/confirm", admin)).toEqual({
      kind: "continue",
    });
  });
});
