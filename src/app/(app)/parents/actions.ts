"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { createServerDb } from "@/db/server";
import {
  type ParentField,
  parentFormToRaw,
  parentIdSchema,
  parentInputSchema,
} from "@/features/parents/schema";
import { type ParentError, updateParent } from "@/features/parents/service";

export type ParentActionResult =
  { ok: true } | { ok: false; error: ParentError; fields?: ParentField[] };

const PARENT_FIELDS = new Set<string>([
  "name",
  "phone",
  "messageLocale",
  "note",
]);

// Order in every action: session and role, then Zod, then the service, then revalidation.

export async function updateParentAction(
  parentId: string,
  form: FormData,
): Promise<ParentActionResult> {
  const actor = await requireStaff(STAFF_ROLES);
  const id = parentIdSchema.safeParse(parentId);
  if (!id.success) return { ok: false, error: "not_found" };
  const parsed = parentInputSchema.safeParse(parentFormToRaw(form));
  if (!parsed.success) {
    // Which fields are wrong; the values themselves never leave the form.
    const fields = parsed.error.issues
      .map((issue) => issue.path[0])
      .filter(
        (field): field is ParentField =>
          typeof field === "string" && PARENT_FIELDS.has(field),
      );
    return { ok: false, error: "invalid", fields: [...new Set(fields)] };
  }
  const result = await updateParent(
    await createServerDb(),
    actor,
    id.data,
    parsed.data,
  );
  if (!result.ok) return result;
  // The parent's card, the children's cards and the Today screen show the parent.
  revalidatePath("/parents", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/today");
  return { ok: true };
}
