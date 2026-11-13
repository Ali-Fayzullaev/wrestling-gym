import { describe, expect, it } from "vitest";

import { sessionCookieOptions } from "./cookie-options";

describe("sessionCookieOptions", () => {
  it("is httpOnly, lax and secure in production", () => {
    expect(sessionCookieOptions("production")).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
  });

  it("drops secure only outside production builds", () => {
    const options = sessionCookieOptions("development");
    expect(options.secure).toBe(false);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
  });
});
