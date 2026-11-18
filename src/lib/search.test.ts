import { describe, expect, it } from "vitest";

import {
  isEmptyQuery,
  matchesQuery,
  normalizeSearch,
  parseQuery,
  toSearchable,
} from "./search";

const kasymov = toSearchable("Қасымов Алихан", "+77011234567");
const ivanov = toSearchable("Иванов Пётр", "+77770000001");
const find = (query: string, entry = kasymov) =>
  matchesQuery(entry, parseQuery(query));

describe("normalizeSearch", () => {
  it("lower-cases and folds ё and Kazakh letters", () => {
    expect(normalizeSearch("ЁЛКА")).toBe("елка");
    expect(normalizeSearch("ҚҒҢӨҰҮҺІӘ")).toBe("кгноуухиа");
    expect(normalizeSearch("қғңөұүһіә")).toBe("кгноуухиа");
  });
});

describe("search by name", () => {
  it.each([
    "касымов",
    "КАСЫМОВ",
    "қас",
    "Қасымов",
    "алихан",
    "касымов али",
    "али кас",
  ])("finds «Қасымов Алихан» by %j", (query) => {
    expect(find(query)).toBe(true);
  });

  it("folds ё in the list and in the query", () => {
    expect(find("петр", ivanov)).toBe(true);
    expect(find("пётр", ivanov)).toBe(true);
  });

  it.each(["касымова", "иванов", "кас бек"])(
    "does not find it by %j",
    (query) => {
      expect(find(query)).toBe(false);
    },
  );
});

describe("search by phone", () => {
  it.each(["7011234", "+7 701 123", "8 701 123 45 67", "4567", "+77011234567"])(
    "finds the phone by %j",
    (query) => {
      expect(find(query)).toBe(true);
    },
  );

  it.each(["7011235", "+7 777"])("does not find it by %j", (query) => {
    expect(find(query)).toBe(false);
  });

  it("combines a name and digits", () => {
    expect(find("кас 4567")).toBe(true);
    expect(find("иван 4567")).toBe(false);
  });
});

describe("empty query", () => {
  it("is empty for spaces and punctuation", () => {
    expect(isEmptyQuery(parseQuery("  ,- "))).toBe(true);
    expect(isEmptyQuery(parseQuery("а"))).toBe(false);
  });

  it("matches everyone", () => {
    expect(find("")).toBe(true);
  });
});

describe("search over several phones (a child and the parent)", () => {
  const child = toSearchable("Касымов Арман Айгуль", [null, "+77012223344"]);
  const both = toSearchable("Касымов Арман", ["+77019990011", "+77012223344"]);

  it("finds a child without a phone by the parent's phone", () => {
    expect(matchesQuery(child, parseQuery("2223344"))).toBe(true);
  });

  it("finds by either phone", () => {
    expect(matchesQuery(both, parseQuery("9990011"))).toBe(true);
    expect(matchesQuery(both, parseQuery("2223344"))).toBe(true);
  });

  it("never matches digits spanning two phones", () => {
    // The end of the first number and the start of the second: "0011" + "7701".
    expect(matchesQuery(both, parseQuery("00117701"))).toBe(false);
  });
});
