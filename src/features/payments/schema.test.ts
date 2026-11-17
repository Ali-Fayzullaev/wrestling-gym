import { describe, expect, it } from "vitest";

import {
  cancelPaymentSchema,
  recordPaymentSchema,
  reversePaymentSchema,
} from "./schema";

const ID = "20000000-0000-4000-8000-000000000001";
const KEY = "4b0c1d4e-6f1a-4c3b-9d2e-1a2b3c4d5e6f";

describe("recordPaymentSchema", () => {
  const valid = {
    clientId: ID,
    amount: "15000",
    method: "kaspi",
    idempotencyKey: KEY,
  };

  it("accepts a payment and turns the amount into a number", () => {
    expect(recordPaymentSchema.parse(valid).amount).toBe(15000);
  });

  it.each([["0"], ["-100"], ["15000.5"], ["10000001"], ["abc"], [""]])(
    "rejects the amount %s",
    (amount) => {
      expect(recordPaymentSchema.safeParse({ ...valid, amount }).success).toBe(
        false,
      );
    },
  );

  it("rejects an unknown method, a non-uuid client and a missing key", () => {
    expect(
      recordPaymentSchema.safeParse({ ...valid, method: "card" }).success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({ ...valid, clientId: "1" }).success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({ ...valid, idempotencyKey: undefined })
        .success,
    ).toBe(false);
  });
});

describe("recordPaymentSchema periodEnd (D-16)", () => {
  const valid = {
    clientId: ID,
    amount: "15000",
    method: "cash",
    idempotencyKey: KEY,
  };

  it("is optional and takes a calendar date YYYY-MM-DD", () => {
    expect(recordPaymentSchema.parse(valid).periodEnd).toBeUndefined();
    expect(
      recordPaymentSchema.parse({ ...valid, periodEnd: "2027-01-16" })
        .periodEnd,
    ).toBe("2027-01-16");
  });

  it.each([["16.01.2027"], ["2027-02-30"], ["2027-1-16"], [""], ["tomorrow"]])(
    "rejects %s",
    (periodEnd) => {
      expect(
        recordPaymentSchema.safeParse({ ...valid, periodEnd }).success,
      ).toBe(false);
    },
  );
});

describe("reversePaymentSchema", () => {
  it("requires a reason, trimmed, at most 500 characters", () => {
    const base = { paymentId: ID, idempotencyKey: KEY };
    expect(
      reversePaymentSchema.parse({ ...base, reason: "  Ошибка  " }).reason,
    ).toBe("Ошибка");
    expect(
      reversePaymentSchema.safeParse({ ...base, reason: "   " }).success,
    ).toBe(false);
    expect(
      reversePaymentSchema.safeParse({ ...base, reason: "а".repeat(501) })
        .success,
    ).toBe(false);
  });
});

describe("cancelPaymentSchema", () => {
  it("takes a payment id and a key", () => {
    expect(
      cancelPaymentSchema.safeParse({ paymentId: ID, idempotencyKey: KEY })
        .success,
    ).toBe(true);
    expect(cancelPaymentSchema.safeParse({ paymentId: ID }).success).toBe(
      false,
    );
  });
});
