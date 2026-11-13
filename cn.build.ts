/**
 * `cn build` fits the class-merge tables to the classes this project uses, instead of shipping
 * tailwind-merge's full tables to every page (about 2 KB gzip less on each route's first load,
 * which the 150 KB budget needs). next.config.ts regenerates the file on build and in dev;
 * src/lib/cn-tables.test.ts fails when the committed copy is stale.
 */
export const cnBuildOptions = {
  content: ["src/**/*.tsx"],
  css: "src/app/globals.css",
  out: "src/lib/cn-tables.ts",
} as const;
