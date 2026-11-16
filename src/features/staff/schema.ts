import { z } from "zod";

import { STAFF_ROLES } from "@/features/auth/roles";
import { passwordSchema } from "@/features/auth/schema";

import { STAFF_NAME_MAX } from "./form-fields";

export const addStaffSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  fullName: z.string().trim().min(1).max(STAFF_NAME_MAX),
  role: z.enum(STAFF_ROLES),
  // Not trimmed: the owner hands over exactly what they typed.
  password: passwordSchema,
});

export type AddStaffInput = z.infer<typeof addStaffSchema>;

export const staffAccessSchema = z.object({
  staffId: z.uuid(),
  role: z.enum(STAFF_ROLES),
  active: z.boolean(),
});

export type StaffAccessInput = z.infer<typeof staffAccessSchema>;

export const resetStaffPasswordSchema = z.object({
  staffId: z.uuid(),
  password: passwordSchema,
});

export type ResetStaffPasswordInput = z.infer<typeof resetStaffPasswordSchema>;
