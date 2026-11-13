import type { NextConfig } from "next";
import { withCn } from "cn/next";

import { cnBuildOptions } from "./cn.build";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
