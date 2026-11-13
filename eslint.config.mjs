import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

// Dependencies only point down: app -> features -> lib, db, i18n.
const layerBoundaries = [
  {
    target: "./src/features",
    from: "./src/app",
    message: "features must not depend on app (routes, Server Actions).",
  },
  {
    target: "./src/lib",
    from: ["./src/app", "./src/features", "./src/db"],
    message:
      "lib holds generic utilities and must not depend on app, features or db.",
  },
  {
    target: "./src/db",
    from: ["./src/app", "./src/features"],
    message: "db must not depend on app or features.",
  },
  {
    target: "./src/i18n",
    from: ["./src/app", "./src/features", "./src/db"],
    message:
      "i18n holds texts only and must not depend on app, features or db.",
  },
  {
    target: "./src/components",
    from: ["./src/app", "./src/features"],
    message: "shared UI components must not depend on app or features.",
  },
];

export default defineConfig([
  ...nextVitals,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "import/no-restricted-paths": ["error", { zones: layerBoundaries }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/utils.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "cn",
              message:
                "Import cn from @/lib/utils: the bare package ships the full merge tables to every page.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**/service.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "service.ts takes the db client and now as parameters; no next/* imports.",
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright fixtures call a callback named `use`, which is not a React hook.
    files: ["tests/e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    "supabase/.temp/**",
    "src/db/types.ts",
    "src/lib/cn-tables.ts",
  ]),
]);
