import { describe, expect, it } from "vitest";

import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["8 701 123 45 67", "+77011234567"],
    ["+7(701)1234567", "+77011234567"],
    ["7011234567", "+77011234567"],
    ["+7 701 123-45-67", "+77011234567"],
    ["87011234567", "+77011234567"],
    ["77011234567", "+77011234567"],
    ["+77011234567", "+77011234567"],
    ["8 (747) 555.66.77", "+77475556677"],
    ["  +7 777 000 00 01  ", "+77770000001"],
    ["8 705 111 22 33", "+77051112233"],
  ])("accepts %j", (input, phone) => {
    expect(normalizePhone(input)).toBe(phone);
  });

  it.each([
    [""],
    ["   "],
    ["701123456"], // 9 digits
    ["870112345678"], // 12 digits
    ["+7701123456"], // 10 digits after +
    ["+79161234567"], // Russian mobile: the database accepts only +77
    ["89161234567"],
    ["9161234567"],
    ["+996555123456"], // another country
    ["+87011234567"],
    ["7011234567a"],
    ["70112 3456x"],
    ["+7 701 123 45 67 доб. 1"],
    ["7+7011234567"],
    ["++77011234567"],
  ])("refuses %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("groups the digits", () => {
    expect(formatPhone("+77011234567")).toBe("+7 701 123 45 67");
  });

  it("leaves anything else as is", () => {
    expect(formatPhone("123")).toBe("123");
  });
});
