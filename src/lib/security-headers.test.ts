import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  createNonce,
  sha256Source,
  STATIC_SECURITY_HEADERS,
} from "./security-headers";

const base = {
  nonce: "abc123",
  scriptHashes: ["'sha256-script'"],
  isDev: false,
  isHttps: true,
};

function directive(policy: string, name: string): string | undefined {
  return policy
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("contentSecurityPolicy", () => {
  it("allows scripts only by nonce, known hashes and strict-dynamic", () => {
    const policy = contentSecurityPolicy(base);
    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'sha256-script' 'strict-dynamic'",
    );
    expect(policy).not.toContain("unsafe-eval");
    expect(directive(policy, "script-src")).not.toContain("unsafe-inline");
  });

  it("allows inline styles without a nonce, which would switch unsafe-inline off", () => {
    expect(directive(contentSecurityPolicy(base), "style-src")).toBe(
      "style-src 'self' 'unsafe-inline'",
    );
  });

  it("forbids framing, plugins, foreign base, forms and connections", () => {
    const policy = contentSecurityPolicy(base);
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
  });

  it("adds eval only in development", () => {
    const policy = contentSecurityPolicy({ ...base, isDev: true });
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests only over HTTPS", () => {
    expect(contentSecurityPolicy(base)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ ...base, isHttps: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("sets HSTS for two years with preload and denies framing", () => {
    const byKey = new Map(
      STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value]),
    );
    expect(byKey.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(byKey.get("Permissions-Policy")).toContain("camera=()");
    expect(byKey.get("Permissions-Policy")).toContain("microphone=()");
    expect(byKey.get("Permissions-Policy")).toContain("geolocation=()");
  });
});

describe("createNonce", () => {
  it("returns 128 random bits in base64, different every time", () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    }
  });
});

describe("sha256Source", () => {
  it("matches the hash the browser computes for the block", async () => {
    const text = "body { margin: 0; }";
    const expected = createHash("sha256").update(text).digest("base64");
    expect(await sha256Source(text)).toBe(`'sha256-${expected}'`);
  });
});
