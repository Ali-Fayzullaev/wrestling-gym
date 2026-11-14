"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import type { ActionResult } from "@/features/clients/result";
import {
  archiveClientSchema,
  type ClientField,
  clientFormToRaw,
  clientIdSchema,
  clientInputSchema,
  deleteClientSchema,
  phoneCheckSchema,
} from "@/features/clients/schema";
import {
  createClient,
  deleteClient,
  type DeleteOutcome,
  findPhoneDuplicates,
  type PhoneDuplicate,
  setClientArchived,
  updateClient,
} from "@/features/clients/service";
import { normalizePhone } from "@/lib/phone";

const CLIENT_FIELDS = new Set<string>([
  "lastName",
  "firstName",
  "birthDate",
  "phone",
  "phoneOwner",
  "parentName",
  "groupId",
  "startedOn",
  "note",
  "consents",
]);

/** Which form fields are wrong; the values themselves never leave the form. */
function invalidFields(issues: { path: PropertyKey[] }[]): ClientField[] {
  const fields = new Set<ClientField>();
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && CLIENT_FIELDS.has(field))
      fields.add(field as ClientField);
  }
  return [...fields];
}

function refreshClients() {
  // "layout" covers /clients and every screen below it; group screens show clients and counts.
  revalidatePath("/clients", "layout");
  revalidatePath("/groups", "layout");
}

function withFields<T>(result: ActionResult<T>): ActionResult<T> {
  if (result.ok || result.error !== "group_not_found") return result;
  return { ...result, fields: ["groupId"] };
}

// Order in every action: session and role, then Zod, then the service, then revalidation.

export async function createClientAction(
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = clientInputSchema.safeParse(clientFormToRaw(form));
  if (!parsed.success)
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error.issues),
    };
  const result = await createClient(await createServerDb(), actor, parsed.data);
  if (result.ok) refreshClients();
  return withFields(result);
}

export async function updateClientAction(
  clientId: string,
  form: FormData,
): Promise<ActionResult<null>> {
  const actor = await requireStaff(STAFF_ROLES);
  const id = clientIdSchema.safeParse(clientId);
  if (!id.success) return { ok: false, error: "not_found" };
  const parsed = clientInputSchema.safeParse(clientFormToRaw(form));
  if (!parsed.success)
    return {
      ok: false,
      error: "invalid",
      fields: invalidFields(parsed.error.issues),
    };
  const result = await updateClient(
    await createServerDb(),
    actor,
    id.data,
    parsed.data,
  );
  if (result.ok) refreshClients();
  return withFields(result);
}

/**
 * Other clients with the typed phone. An unfinished or wrong number simply has no duplicates: the
 * form shows its own message for that.
 */
export async function checkPhoneAction(
  raw: unknown,
): Promise<ActionResult<PhoneDuplicate[]>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = phoneCheckSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const phone = normalizePhone(parsed.data.phone);
  if (phone === null) return { ok: true, data: [] };
  return findPhoneDuplicates(
    await createServerDb(),
    actor,
    phone,
    parsed.data.excludeId,
  );
}

export async function setClientArchivedAction(
  raw: unknown,
): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await requireStaff(STAFF_ROLES);
  const parsed = archiveClientSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await setClientArchived(
    await createServerDb(),
    actor,
    parsed.data,
  );
  if (result.ok) refreshClients();
  return result;
}

/** Owner only; requireStaff sends an admin to the 403 page before anything else runs. */
export async function deleteClientAction(
  raw: unknown,
): Promise<ActionResult<DeleteOutcome>> {
  const actor = await requireStaff(["owner"]);
  const parsed = deleteClientSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await deleteClient(await createServerDb(), actor, parsed.data);
  if (result.ok) refreshClients();
  return result;
}
