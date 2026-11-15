import { z } from "zod";

import { STAFF_ROLES } from "@/features/auth/roles";

import { STAFF_NAME_MAX } from "./form-fields";

export const inviteStaffSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  fullName: z.string().trim().min(1).max(STAFF_NAME_MAX),
  role: z.enum(STAFF_ROLES),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const staffAccessSchema = z.object({
  staffId: z.uuid(),
  role: z.enum(STAFF_ROLES),
  active: z.boolean(),
});

export type StaffAccessInput = z.infer<typeof staffAccessSchema>;
