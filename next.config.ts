import type { NextConfig } from "next";
import { withCn } from "cn/next";

import { cnBuildOptions } from "./cn.build";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // No cacheComponents (PPR): a prerendered static shell carries scripts without the per-request
  // CSP nonce, and browsers block them. See docs/spec/13-deploy.md, notes.
  experimental: {
    serverActions: {
      // The client import sends a file of up to 2 MB (src/features/import/limits.ts) plus the
      // multipart overhead; every other action stays far below. The import checks the size itself.
      bodySizeLimit: "2200kb",
    },
  },
  // Static files skip the proxy; the constant headers reach them from here. The CSP needs a nonce
  // per request and is set by the proxy (src/proxy.ts).
  headers: async () => [
    { source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] },
  ],
  poweredByHeader: false,
  // The home screen is "Today"; the proxy sends guests on to sign-in.
  redirects: async () => [
    { source: "/", destination: "/today", permanent: false },
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withCn(nextConfig, {
  ...cnBuildOptions,
  content: [...cnBuildOptions.content],
});
