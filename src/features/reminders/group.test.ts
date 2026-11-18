import { describe, expect, it } from "vitest";

import { groupDueRows } from "./group";

function due(id: string, parentId: string | null = null) {
  return {
    id,
    name: `Фамилия ${id}`,
    firstName: id,
    groupName: null,
    price: null,
    endsOn: "2026-11-20",
    paymentId: `payment-${id}`,
    kind: "before_7",
    phone: "+77000000001",
    parentId,
    parentName: parentId === null ? null : "Айгуль",
    messageLocale: "ru",
  };
}

const ids = (groups: { id: string }[][]) =>
  groups.map((group) => group.map((r) => r.id));

describe("groupDueRows (D-18)", () => {
  it("puts the children of one parent into one group at the place of the first", () => {
    const rows = [
      due("A"),
      due("B", "p1"),
      due("C"),
      due("D", "p1"),
      due("E", "p2"),
    ];
    expect(ids(groupDueRows(rows))).toEqual([["A"], ["B", "D"], ["C"], ["E"]]);
  });

  it("keeps adults apart even with the same phone", () => {
    expect(ids(groupDueRows([due("A"), due("B")]))).toEqual([["A"], ["B"]]);
  });

  it("is empty for no rows", () => {
    expect(groupDueRows([])).toEqual([]);
  });
});
