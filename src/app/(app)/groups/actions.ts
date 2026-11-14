"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import {
  archiveGroupSchema,
  type GroupField,
  groupFormToRaw,
  groupIdSchema,
  groupInputSchema,
  moveClientsSchema,
} from "@/features/groups/schema";
import type { ActionResult } from "@/features/groups/result";
import {
  archiveGroup,
  type ArchiveOutcome,
  createGroup,
  moveClients,
  type MoveOutcome,
  updateGroup,
} from "@/features/groups/service";

const GROUP_FIELDS = new Set<string>([
  "name",
  "coachId",
  "schedule",
  "defaultPrice",
  "capacity",
]);

/** Which form fields are wrong; the values themselves never leave the form. */
function invalidFields(issues: { path: PropertyKey[] }[]): GroupField[] {
  const fields = new Set<GroupField>();
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && GROUP_FIELDS.has(field))
      fields.add(field as GroupField);
  }
  return [...fields];
}

function refreshGroups() {
  // "layout" covers /groups and every /groups/[id] below it.
  revalidatePath("/groups", "layout");
}

// Order in every action: session and role, then Zod, then the service, then revalidation.

export async function createGroupAction(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireStaff(["owner"]);
  const parsed = groupInputSchema.safeParse(groupFormToRaw(form));
  if (!parsed.success)
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error.issues),
    };
  const result = await createGroup(await createServerDb(), actor, parsed.data);
  if (result.ok) refreshGroups();
  return result.ok
    ? result
    : {
        ok: false,
        error: result.error,
        fields: result.error === "coach_not_found" ? ["coachId"] : undefined,
      };
}

export async function updateGroupAction(
  groupId: string,
  form: FormData,
): Promise<ActionResult<null>> {
  const actor = await requireStaff(["owner"]);
  const id = groupIdSchema.safeParse(groupId);
  if (!id.success) return { ok: false, error: "not_found" };
  const parsed = groupInputSchema.safeParse(groupFormToRaw(form));
  if (!parsed.success)
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error.issues),
    };
  const result = await updateGroup(
    await createServerDb(),
    actor,
    id.data,
    parsed.data,
  );
  if (result.ok) refreshGroups();
  return result.ok
    ? result
    : {
        ok: false,
        error: result.error,
        fields: result.error === "coach_not_found" ? ["coachId"] : undefined,
      };
}

export async function archiveGroupAction(
  raw: unknown,
): Promise<ActionResult<ArchiveOutcome>> {
  const actor = await requireStaff(["owner"]);
  const parsed = archiveGroupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await archiveGroup(await createServerDb(), actor, parsed.data);
  if (result.ok && result.data.archived) refreshGroups();
  return result;
}

/** Owner and admin: a transfer changes clients, which admins work with every day. */
export async function moveClientsAction(
  raw: unknown,
): Promise<ActionResult<MoveOutcome>> {
  const actor = await requireStaff(["owner", "admin"]);
  const parsed = moveClientsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await moveClients(await createServerDb(), actor, parsed.data);
  if (result.ok) refreshGroups();
  return result;
}
