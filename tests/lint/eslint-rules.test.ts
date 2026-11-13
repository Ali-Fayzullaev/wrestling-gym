import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Guards the lint rules that enforce CLAUDE.md: layer direction and no `any`.
const eslint = new ESLint();

async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "fatal");
}

const importHomePage = (specifier: string) =>
  `import HomePage from "${specifier}";\nexport const page = HomePage;\n`;

describe("layer boundaries", () => {
  it("rejects lib importing app through the alias", async () => {
    expect(
      await ruleIdsFor(importHomePage("@/app/page"), "src/lib/probe.ts"),
    ).toContain("import/no-restricted-paths");
  });

  it("rejects lib importing app through a relative path", async () => {
    expect(
      await ruleIdsFor(importHomePage("../app/page"), "src/lib/probe.ts"),
    ).toContain("import/no-restricted-paths");
  });

  it("rejects features importing app", async () => {
    expect(
      await ruleIdsFor(
        importHomePage("@/app/page"),
        "src/features/probe/component.ts",
      ),
    ).toContain("import/no-restricted-paths");
  });

  it("rejects service.ts importing next/*", async () => {
    const code = `import { headers } from "next/headers";\nexport const read = headers;\n`;
    expect(await ruleIdsFor(code, "src/features/probe/service.ts")).toContain(
      "no-restricted-imports",
    );
  });

  it("allows app importing lib", async () => {
    const code = `import { businessDate } from "@/lib/dates";\nexport const today = businessDate;\n`;
    expect(await ruleIdsFor(code, "src/app/probe.ts")).toEqual([]);
  });
});

describe("type safety", () => {
  it("rejects explicit any", async () => {
    const code = `export function identity(value: any) {\n  return value;\n}\n`;
    expect(await ruleIdsFor(code, "src/lib/probe.ts")).toContain(
      "@typescript-eslint/no-explicit-any",
    );
  });
});
