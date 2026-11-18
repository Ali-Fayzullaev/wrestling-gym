/**
 * Puts the children of one parent into one group, at the place of the first of them (the rows
 * come in the screen's order); everybody else is a group of one. One group is one WhatsApp
 * message (D-18): the Today screen and the Reminders tabs group the same way.
 */
export function groupDueRows<T extends { parentId: string | null }>(
  rows: readonly T[],
): T[][] {
  const groups: T[][] = [];
  const byParent = new Map<string, T[]>();
  for (const row of rows) {
    if (row.parentId === null) {
      groups.push([row]);
      continue;
    }
    const group = byParent.get(row.parentId);
    if (group) {
      group.push(row);
      continue;
    }
    const created = [row];
    byParent.set(row.parentId, created);
    groups.push(created);
  }
  return groups;
}
