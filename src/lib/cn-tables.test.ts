import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "cn/build";
import { describe, expect, it } from "vitest";

import { cnBuildOptions } from "../../cn.build";

import { cn } from "./utils";

describe("cn tables", () => {
  it("match the classes in the sources (run `pnpm build` or `pnpm dev` to refresh)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cn-tables-"));
    try {
      const fresh = await build({
        ...cnBuildOptions,
        content: [...cnBuildOptions.content],
        out: join(dir, "cn-tables.ts"),
      });
      const committed = await readFile(cnBuildOptions.out, "utf8");
      expect(committed).toBe(fresh.source);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("let a later class override a conflicting one", () => {
    expect(cn("h-11 px-4", "h-9")).toBe("px-4 h-9");
    expect(cn("justify-center", "justify-start")).toBe("justify-start");
    expect(cn("bg-primary", false, "bg-destructive")).toBe("bg-destructive");
  });
});
