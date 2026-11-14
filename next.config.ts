import type { NextConfig } from "next";
import { withCn } from "cn/next";

import { cnBuildOptions } from "./cn.build";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // The client import sends a file of up to 2 MB (src/features/import/limits.ts) plus the
      // multipart overhead; every other action stays far below. The import checks the size itself.
      bodySizeLimit: "2200kb",
    },
  },
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
