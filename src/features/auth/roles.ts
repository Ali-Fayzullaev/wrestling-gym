export const STAFF_ROLES = ["owner", "admin"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** The signed-in employee, as every service and Server Action receives it. */
export type Actor = { id: string; role: StaffRole };

export function isStaffRole(value: unknown): value is StaffRole {
  return (
    typeof value === "string" &&
    (STAFF_ROLES as readonly string[]).includes(value)
  );
}
