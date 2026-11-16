import { describe, expect, it } from "vitest";

import { decideNavigation, routeAccess } from "./routes";

describe("routeAccess", () => {
  it.each([
    ["/login", "public"],
    // Ending a session must work without one too (expired cookie): the handler just redirects.
    ["/auth/sign-out", "public"],
    // Password reset by email is gone (D-14): these are ordinary unknown pages now.
    ["/reset-password", "staff"],
    ["/auth/confirm", "staff"],
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
  const owner = {
    signedIn: true,
    role: "owner",
    mustChangePassword: false,
  } as const;
  const admin = {
    signedIn: true,
    role: "admin",
    mustChangePassword: false,
  } as const;
  const inactive = {
    signedIn: true,
    role: null,
    mustChangePassword: false,
  } as const;
  const temporary = {
    signedIn: true,
    role: "admin",
    mustChangePassword: true,
  } as const;
  const temporaryOwner = { ...temporary, role: "owner" } as const;

  it("sends guests to sign-in except on public pages", () => {
    expect(decideNavigation("/clients", guest)).toEqual({ kind: "login" });
    expect(decideNavigation("/reports", guest)).toEqual({ kind: "login" });
    expect(decideNavigation("/update-password", guest)).toEqual({
      kind: "login",
    });
    expect(decideNavigation("/reset-password", guest)).toEqual({
      kind: "login",
    });
    expect(decideNavigation("/login", guest)).toEqual({ kind: "continue" });
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
    expect(decideNavigation("/update-password", admin)).toEqual({
      kind: "continue",
    });
  });

  it("keeps an employee with a temporary password on the password form", () => {
    for (const session of [temporary, temporaryOwner]) {
      for (const path of [
        "/today",
        "/clients",
        "/settings/staff",
        "/login",
        "/update-passwordx",
      ]) {
        expect(decideNavigation(path, session)).toEqual({
          kind: "change-password",
        });
      }
      expect(decideNavigation("/update-password", session)).toEqual({
        kind: "continue",
      });
      expect(decideNavigation("/auth/sign-out", session)).toEqual({
        kind: "continue",
      });
    }
  });
});
