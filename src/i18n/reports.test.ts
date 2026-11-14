import { describe, expect, it } from "vitest";

import { reportsText } from "./reports";

describe("reportsText counts", () => {
  it.each([
    [0, "0 оплат"],
    [1, "1 оплата"],
    [3, "3 оплаты"],
    [5, "5 оплат"],
    [11, "11 оплат"],
    [21, "21 оплата"],
    [43, "43 оплаты"],
  ])("%i payments", (count, text) => {
    expect(reportsText.total.count(count)).toBe(text);
  });

  it.each([
    [1, "1 человек"],
    [2, "2 человека"],
    [5, "5 человек"],
    [12, "12 человек"],
    [22, "22 человека"],
  ])("%i debtors", (count, text) => {
    expect(reportsText.debtors.count(count)).toBe(text);
  });
});
