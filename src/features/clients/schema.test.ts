import { describe, expect, it } from "vitest";

import {
  clientFormToRaw,
  clientInputSchema,
  deleteClientSchema,
} from "./schema";

const GROUP = "10000000-0000-4000-8000-000000000001";

const valid = {
  lastName: "  Қасымов ",
  firstName: "Алихан",
  birthDate: "",
  phone: "8 701 123 45 67",
  phoneOwner: "self",
  parentName: "",
  groupId: GROUP,
  startedOn: "2026-11-01",
  note: "",
  messageLocale: "kk",
  consents: ["data_processing", "messaging", "messaging"],
};

function issuesOf(raw: unknown): PropertyKey[] {
  const result = clientInputSchema.safeParse(raw);
  // One field may fail more than one rule; the form only needs to know which field.
  return result.success
    ? []
    : [...new Set(result.error.issues.map((i) => i.path[0] ?? ""))];
}

describe("clientInputSchema", () => {
  it("normalizes the phone, trims names, empties to null, de-duplicates consents", () => {
    expect(clientInputSchema.parse(valid)).toEqual({
      lastName: "Қасымов",
      firstName: "Алихан",
      birthDate: null,
      phone: "+77011234567",
      phoneOwner: "self",
      parentName: null,
      groupId: GROUP,
      startedOn: "2026-11-01",
      note: "",
      messageLocale: "kk",
      consents: ["data_processing", "messaging"],
    });
  });

  it.each(["", "en", "uz-Latn", "Қазақша"])(
    "refuses the message language %j",
    (messageLocale) => {
      expect(issuesOf({ ...valid, messageLocale })).toEqual(["messageLocale"]);
    },
  );

  it.each(["123", "+79161234567", "8 701 123 45", "телефон", ""])(
    "refuses the phone %j",
    (phone) => {
      expect(issuesOf({ ...valid, phone })).toEqual(["phone"]);
    },
  );

  it("requires the parent's name when the phone is a parent's", () => {
    expect(issuesOf({ ...valid, phoneOwner: "parent" })).toEqual([
      "parentName",
    ]);
    const parsed = clientInputSchema.parse({
      ...valid,
      phoneOwner: "parent",
      parentName: "Гульнара",
    });
    expect(parsed.parentName).toBe("Гульнара");
  });

  it("drops a parent's name typed for an adult's own phone", () => {
    expect(
      clientInputSchema.parse({ ...valid, parentName: "Гульнара" }).parentName,
    ).toBeNull();
  });

  it("allows no group", () => {
    expect(
      clientInputSchema.parse({ ...valid, groupId: "" }).groupId,
    ).toBeNull();
  });

  it.each([
    [{ lastName: " " }, "lastName"],
    [{ firstName: "x".repeat(101) }, "firstName"],
    [{ birthDate: "2026-02-30" }, "birthDate"],
    [{ birthDate: "01.02.2015" }, "birthDate"],
    [{ startedOn: "" }, "startedOn"],
    [{ groupId: "Дети" }, "groupId"],
    [{ phoneOwner: "neighbour" }, "phoneOwner"],
    [{ note: "x".repeat(2001) }, "note"],
    [{ consents: ["marketing"] }, "consents"],
  ])("refuses %j", (override, field) => {
    expect(issuesOf({ ...valid, ...override })).toEqual([field]);
  });
});

describe("clientFormToRaw", () => {
  it("reads every field and all ticked consents", () => {
    const form = new FormData();
    form.set("lastName", "Иванов");
    form.set("phone", "7011234567");
    form.append("consent", "data_processing");
    form.append("consent", "messaging");
    const raw = clientFormToRaw(form);
    expect(raw.lastName).toBe("Иванов");
    expect(raw.firstName).toBe("");
    expect(raw.consents).toEqual(["data_processing", "messaging"]);
  });
});

describe("deleteClientSchema", () => {
  it("accepts a reason from the list only", () => {
    const base = { clientId: GROUP, lastName: "Иванов" };
    expect(
      deleteClientSchema.safeParse({ ...base, reason: "duplicate" }).success,
    ).toBe(true);
    expect(
      deleteClientSchema.safeParse({ ...base, reason: "Иванов попросил" })
        .success,
    ).toBe(false);
  });
});
