import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

import { GYM_NAME_MAX } from "./form-fields";

/** "Gym" section of the settings: the number is optional and stored as +77XXXXXXXXX. */
export const gymSettingsSchema = z.object({
  gymName: z.string().trim().min(1).max(GYM_NAME_MAX),
  gymWhatsapp: z
    .string()
    .trim()
    .max(30)
    .transform((value, context) => {
      if (value === "") return null;
      const phone = normalizePhone(value);
      if (phone === null) {
        context.addIssue({ code: "custom", message: "phone" });
        return z.NEVER;
      }
      return phone;
    }),
});

export type GymSettingsInput = z.infer<typeof gymSettingsSchema>;
