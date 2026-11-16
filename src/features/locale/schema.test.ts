import { describe, expect, it } from "vitest";

import { localeSchema } from "./schema";

describe("localeSchema", () => {
  it.each(["ru", "kk", "uz"])("accepts %s", (value) => {
    expect(localeSchema.parse(value)).toBe(value);
  });

  it.each(["en", "uz-Latn", "", null, 1, "RU"])("refuses %o", (value) => {
    expect(localeSchema.safeParse(value).success).toBe(false);
  });
});
