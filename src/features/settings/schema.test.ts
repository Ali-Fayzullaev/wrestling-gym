import { describe, expect, it } from "vitest";

import { gymSettingsSchema } from "./schema";

describe("gymSettingsSchema", () => {
  it("trims the name and normalizes the number to +77XXXXXXXXX", () => {
    expect(
      gymSettingsSchema.parse({
        gymName: "  Барыс  ",
        gymWhatsapp: "8 (701) 123-45-67",
      }),
    ).toEqual({ gymName: "Барыс", gymWhatsapp: "+77011234567" });
  });

  it("an empty number clears it", () => {
    expect(
      gymSettingsSchema.parse({ gymName: "Барыс", gymWhatsapp: "  " })
        .gymWhatsapp,
    ).toBeNull();
  });

  it.each([
    [{ gymName: "", gymWhatsapp: "" }, "gymName"],
    [{ gymName: "x".repeat(101), gymWhatsapp: "" }, "gymName"],
    [{ gymName: "Барыс", gymWhatsapp: "+7 495 123 45 67" }, "gymWhatsapp"],
    [{ gymName: "Барыс", gymWhatsapp: "12345" }, "gymWhatsapp"],
  ])("refuses %o on %s", (input, field) => {
    const result = gymSettingsSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });
});
