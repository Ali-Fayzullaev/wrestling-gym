import { describe, expect, it } from "vitest";

import {
  clientFormToRaw,
  clientInputSchema,
  deleteClientSchema,
} from "./schema";

const GROUP = "10000000-0000-4000-8000-000000000001";
const PARENT = "30000000-0000-4000-8000-000000000001";

const valid = {
  lastName: "  Қасымов ",
  firstName: "Алихан",
  birthDate: "",
  phone: "8 701 123 45 67",
  kind: "adult",
  parentMode: "existing",
  parentId: "",
  newParentName: "",
  newParentPhone: "",
  newParentLocale: "ru",
  groupId: GROUP,
  startedOn: "2026-11-01",
  note: "",
  messageLocale: "kk",
};

function issuesOf(raw: unknown): PropertyKey[] {
  const result = clientInputSchema.safeParse(raw);
  // One field may fail more than one rule; the form only needs to know which field.
  return result.success
    ? []
    : [...new Set(result.error.issues.map((i) => i.path[0] ?? ""))];
}

describe("clientInputSchema", () => {
  it("normalizes the phone, trims names, empties to null", () => {
    expect(clientInputSchema.parse(valid)).toEqual({
      lastName: "Қасымов",
      firstName: "Алихан",
      birthDate: null,
      phone: "+77011234567",
      parent: null,
      groupId: GROUP,
      startedOn: "2026-11-01",
      note: "",
      messageLocale: "kk",
    });
  });

  it("D-10: drops a consents field sent anyway, so it never reaches the database", () => {
    const parsed = clientInputSchema.parse({
      ...valid,
      consents: ["data_processing", "messaging"],
    });
    expect(parsed).not.toHaveProperty("consents");
  });

  it.each(["", "en", "uz-Latn", "Қазақша"])(
    "refuses the message language %j",
    (messageLocale) => {
      expect(issuesOf({ ...valid, messageLocale })).toEqual(["messageLocale"]);
    },
  );

  it.each(["123", "+79161234567", "8 701 123 45", "телефон", ""])(
    "refuses the adult's phone %j",
    (phone) => {
      expect(issuesOf({ ...valid, phone })).toEqual(["phone"]);
    },
  );

  it("drops a parent typed for an adult: an adult is reminded directly", () => {
    expect(
      clientInputSchema.parse({ ...valid, parentId: PARENT }).parent,
    ).toBeNull();
  });
});

describe("clientInputSchema: a child (D-18)", () => {
  const child = { ...valid, kind: "child", phone: "" };

  it("saves a child without a phone of their own with an existing parent", () => {
    const parsed = clientInputSchema.parse({ ...child, parentId: PARENT });
    expect(parsed.phone).toBeNull();
    expect(parsed.parent).toEqual({ kind: "existing", id: PARENT });
  });

  it("keeps a child's own phone when there is one", () => {
    const parsed = clientInputSchema.parse({
      ...child,
      phone: "8 702 000 11 22",
      parentId: PARENT,
    });
    expect(parsed.phone).toBe("+77020001122");
  });

  it("still refuses a wrong child's phone", () => {
    expect(issuesOf({ ...child, phone: "123", parentId: PARENT })).toEqual([
      "phone",
    ]);
  });

  it("requires a parent: chosen, or entered as new", () => {
    expect(issuesOf(child)).toEqual(["parentId"]);
    expect(issuesOf({ ...child, parentMode: "new" })).toEqual([
      "newParentName",
      "newParentPhone",
    ]);
  });

  it("creates a new parent with a normalised phone and the chosen language", () => {
    const parsed = clientInputSchema.parse({
      ...child,
      parentMode: "new",
      parentId: PARENT,
      newParentName: " Айгуль ",
      newParentPhone: "8 701 222 33 44",
      newParentLocale: "uz",
    });
    // The typed new parent wins over a stale chosen one.
    expect(parsed.parent).toEqual({
      kind: "new",
      name: "Айгуль",
      phone: "+77012223344",
      messageLocale: "uz",
    });
  });

  it.each([
    [{ parentId: "Айгуль" }, "parentId"],
    [
      { parentMode: "new", newParentName: "Айгуль", newParentPhone: "123" },
      "newParentPhone",
    ],
    [
      {
        parentMode: "new",
        newParentName: "x".repeat(101),
        newParentPhone: "87012223344",
      },
      "newParentName",
    ],
  ])("refuses %j", (override, field) => {
    expect(issuesOf({ ...child, ...override })).toEqual([field]);
  });
});

describe("clientInputSchema: other fields", () => {
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
    [{ kind: "neighbour" }, "kind"],
    [{ note: "x".repeat(2001) }, "note"],
  ])("refuses %j", (override, field) => {
    expect(issuesOf({ ...valid, ...override })).toEqual([field]);
  });
});

describe("clientFormToRaw", () => {
  it("reads every field and ignores a consent field (D-10)", () => {
    const form = new FormData();
    form.set("lastName", "Иванов");
    form.set("phone", "7011234567");
    form.append("consent", "data_processing");
    const raw = clientFormToRaw(form);
    expect(raw.lastName).toBe("Иванов");
    expect(raw.firstName).toBe("");
    expect(raw).not.toHaveProperty("consents");
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

describe("clientInputSchema: an adult without parent fields", () => {
  it("needs none of the parent fields (the form sends them for a child only)", () => {
    const adult = {
      lastName: "Иванов",
      firstName: "Пётр",
      birthDate: "",
      phone: "87011234567",
      kind: "adult",
      groupId: "",
      startedOn: "2026-11-01",
      note: "",
      messageLocale: "ru",
    };
    expect(clientInputSchema.parse(adult).parent).toBeNull();
  });
});
