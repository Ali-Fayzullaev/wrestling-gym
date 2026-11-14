/**
 * Group names compare case-insensitively, with "ё" as "е" and single spaces. Its own module so
 * the import screen can use it without pulling the file parsers into the browser.
 */
export function groupKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase().replaceAll("ё", "е");
}
