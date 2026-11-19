import { describe, expect, it } from "vitest";

import { childFieldName, CHILD_FIELDS } from "./form-fields";
import {
  childrenFormToRaw,
  childrenInputSchema,
  childrenIssues,
} from "./schema";

// Step 24 (D-24): several children of one parent in one save.

const GROUP = "10000000-0000-4000-8000-000000000001";
const PARENT = "30000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-000000000001";

const child = (firstName: string, extra: Record<string, string> = {}) => ({
  lastName: " Сейтов ",
  firstName,
  phone: "",
  groupId: GROUP,
  startedOn: "2026-11-19",
  birthDate: "",
  note: "",
  ...extra,
});

const valid = {
  parentMode: "new",
  parentId: "",
  newParentName: "Гульнара",
  newParentPhone: "8 701 123 45 67",
  newParentLocale: "kk",
  requestKey: KEY,
  children: [child("Арман"), child("Дана"), child("Тимур")],
};

function issues(raw: unknown) {
  const result = childrenInputSchema.safeParse(raw);
  return result.success
    ? { fields: [], childFields: [] }
    : childrenIssues(result.error.issues);
}

describe("childrenInputSchema", () => {
  it("a new parent and three children: names trimmed, phone normalized, empties to null", () => {
    const parsed = childrenInputSchema.parse(valid);
    expect(parsed.parent).toEqual({
      kind: "new",
      name: "Гульнара",
      phone: "+77011234567",
      messageLocale: "kk",
    });
    expect(parsed.requestKey).toBe(KEY);
    expect(parsed.children.map((c) => c.firstName)).toEqual([
      "Арман",
      "Дана",
      "Тимур",
    ]);
    expect(parsed.children[0]).toEqual({
      lastName: "Сейтов",
      firstName: "Арман",
      phone: null,
      groupId: GROUP,
      startedOn: "2026-11-19",
      birthDate: null,
      note: "",
    });
  });

  it("a parent on file", () => {
    const parsed = childrenInputSchema.parse({
      ...valid,
      parentMode: "existing",
      parentId: PARENT,
      children: [child("Алия"), child("Ержан", { groupId: "" })],
    });
    expect(parsed.parent).toEqual({ kind: "existing", id: PARENT });
    expect(parsed.children[1]?.groupId).toBeNull();
  });

  it("an error names the field of the right child", () => {
    expect(
      issues({
        ...valid,
        children: [
          child("Арман"),
          child("", { phone: "12345" }),
          child("Тимур", { startedOn: "2026-02-30" }),
        ],
      }),
    ).toEqual({
      fields: [],
      childFields: [
        { index: 1, field: "firstName" },
        { index: 1, field: "phone" },
        { index: 2, field: "startedOn" },
      ],
    });
  });

  it("a child needs a parent: none chosen, or a new one without name and phone", () => {
    expect(issues({ ...valid, parentMode: "existing" }).fields).toEqual([
      "parentId",
    ]);
    expect(
      issues({ ...valid, newParentName: " ", newParentPhone: "" }).fields,
    ).toEqual(["newParentName", "newParentPhone"]);
    expect(issues({ ...valid, newParentPhone: "8 701" }).fields).toEqual([
      "newParentPhone",
    ]);
  });

  it.each([
    ["no children", []],
    ["eleven children", Array.from({ length: 11 }, (_, i) => child(`Р${i}`))],
  ])("%s: refused, naming no child's field", (_, children) => {
    const result = childrenInputSchema.safeParse({ ...valid, children });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(childrenIssues(result.error.issues)).toEqual({
        fields: [],
        childFields: [],
      });
  });

  it("ten children are accepted", () => {
    const children = Array.from({ length: 10 }, (_, i) => child(`Р${i}`));
    expect(childrenInputSchema.safeParse({ ...valid, children }).success).toBe(
      true,
    );
  });

  it.each(["", "not-a-uuid"])("a request key %j is refused", (requestKey) => {
    expect(
      childrenInputSchema.safeParse({ ...valid, requestKey }).success,
    ).toBe(false);
  });

  it("D-10: a consents field sent anyway is dropped", () => {
    expect(
      childrenInputSchema.parse({ ...valid, consents: ["messaging"] }),
    ).not.toHaveProperty("consents");
  });
});

describe("childrenFormToRaw", () => {
  function formOf(count: number): FormData {
    const form = new FormData();
    form.set("parentMode", "existing");
    form.set("parentId", PARENT);
    form.set("requestKey", KEY);
    for (let index = 0; index < count; index++)
      for (const field of CHILD_FIELDS)
        form.set(
          childFieldName(index, field),
          field === "firstName" ? `Р${index}` : "",
        );
    return form;
  }

  it("reads the children in their order", () => {
    const raw = childrenFormToRaw(formOf(3));
    expect(raw.children).toHaveLength(3);
    expect(raw.requestKey).toBe(KEY);
    expect(
      (raw.children as { firstName: string }[]).map((c) => c.firstName),
    ).toEqual(["Р0", "Р1", "Р2"]);
  });

  it("keeps one child past the limit, so the schema refuses rather than cuts", () => {
    const raw = childrenFormToRaw(formOf(25));
    expect(raw.children).toHaveLength(11);
    expect(childrenInputSchema.safeParse(raw).success).toBe(false);
  });

  it("no child fields: an empty list", () => {
    expect(childrenFormToRaw(new FormData()).children).toEqual([]);
  });
});
