"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { createServerDb } from "@/db/server";
import {
  archiveParentSchema,
  deleteParentSchema,
  type ParentField,
  parentFormToRaw,
  parentIdSchema,
  parentInputSchema,
} from "@/features/parents/schema";
import {
  deleteParent,
  type ParentError,
  setParentArchived,
  updateParent,
} from "@/features/parents/service";

export type ParentActionResult =
  { ok: true } | { ok: false; error: ParentError; fields?: ParentField[] };

function refreshAfterParentChange() {
  // The parent's card, the children's cards and the Today screen show the parent.
  revalidatePath("/parents", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/today");
}

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
  refreshAfterParentChange();
  return { ok: true };
}

/** "To archive" / "Bring back" on the parent's card; owner and admin, repeats are harmless. */
export async function setParentArchivedAction(
  raw: unknown,
): Promise<ParentActionResult> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = archiveParentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await setParentArchived(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (!result.ok) return result;
  refreshAfterParentChange();
  return { ok: true };
}

/** "Delete" on the parent's card: the owner, a parent without children. */
export async function deleteParentAction(
  raw: unknown,
): Promise<ParentActionResult> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = deleteParentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await deleteParent(await createServerDb(), actor, parsed.data);
  if (!result.ok) return result;
  refreshAfterParentChange();
  return { ok: true };
}
