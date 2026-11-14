import { z } from "zod";

/** Query of /reports/export: what, in which format, and the month for payments. */
export const exportQuerySchema = z
  .object({
    data: z.enum(["payments", "clients"]),
    format: z.enum(["xlsx", "csv"]),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .refine((query) => query.data !== "payments" || query.month !== undefined, {
    path: ["month"],
  });

export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type ExportFormat = ExportQuery["format"];
