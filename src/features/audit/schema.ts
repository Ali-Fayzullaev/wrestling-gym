import { z } from "zod";

import { AUDIT_ACTIONS } from "./actions";

const isoDate = z.iso.date();

/** "<created_at ISO>_<id>" of the last entry shown: opaque to the owner, checked here. */
const cursorSchema = z
  .string()
  .max(80)
  .transform((value, context) => {
    const at = value.slice(0, value.lastIndexOf("_"));
    const id = value.slice(value.lastIndexOf("_") + 1);
    const parsed = z
      .object({ at: z.iso.datetime({ offset: true }), id: z.uuid() })
      .safeParse({ at, id });
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "cursor" });
      return z.NEVER;
    }
    return parsed.data;
  });

const emptyToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

/** Query of /audit. Empty form fields mean "any". */
export const auditQuerySchema = z
  .object({
    staff: z.preprocess(emptyToUndefined, z.uuid().optional()),
    action: z.preprocess(emptyToUndefined, z.enum(AUDIT_ACTIONS).optional()),
    from: z.preprocess(emptyToUndefined, isoDate.optional()),
    to: z.preprocess(emptyToUndefined, isoDate.optional()),
    cursor: z.preprocess(emptyToUndefined, cursorSchema.optional()),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ["to"] });

export type AuditQuery = z.infer<typeof auditQuerySchema>;

export function encodeCursor(entry: { createdAt: string; id: string }) {
  return `${entry.createdAt}_${entry.id}`;
}

/** First value of each known parameter; repeated parameters are not a filter the form makes. */
export function auditQueryFromParams(
  params: Record<string, string | string[] | undefined>,
): { query: AuditQuery; invalid: boolean } {
  const pick = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const parsed = auditQuerySchema.safeParse({
    staff: pick("staff"),
    action: pick("action"),
    from: pick("from"),
    to: pick("to"),
    cursor: pick("cursor"),
  });
  return parsed.success
    ? { query: parsed.data, invalid: false }
    : { query: {}, invalid: true };
}
