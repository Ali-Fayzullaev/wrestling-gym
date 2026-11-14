"use server";

import { revalidatePath } from "next/cache";

import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import type { Upload } from "@/features/import/file";
import { MAX_FILE_BYTES } from "@/features/import/limits";
import type {
  ImportReport,
  ImportResult,
  PreviewData,
} from "@/features/import/result";
import {
  groupChoicesSchema,
  mappingSchema,
  parseJsonField,
} from "@/features/import/schema";
import { commitImport, previewImport } from "@/features/import/service";

// Order in every action: session and role, then input checks, then the service, then revalidation.
// The file travels with each request and is parsed on the server only; nothing is stored between
// the preview and the import.

/** The uploaded file, refused before it is read into memory when it is too big. */
async function readUpload(
  form: FormData,
): Promise<
  { ok: true; upload: Upload } | { ok: false; error: "invalid" | "too_large" }
> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "invalid" };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "too_large" };
  return {
    ok: true,
    upload: {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
  };
}

/** Preview: columns and rows with statuses. `mapping` (JSON) is sent once chosen by hand. */
export async function previewImportAction(
  form: FormData,
): Promise<ImportResult<PreviewData>> {
  const actor = await requireStaff(["owner"]);
  const read = await readUpload(form);
  if (!read.ok) return read;
  let mapping = null;
  if (form.has("mapping")) {
    const parsed = mappingSchema.safeParse(parseJsonField(form.get("mapping")));
    if (!parsed.success) return { ok: false, error: "invalid" };
    mapping = parsed.data;
  }
  return previewImport(await createServerDb(), actor, read.upload, mapping);
}

/** Import: the file again, the chosen columns and what to do with unknown groups. */
export async function commitImportAction(
  form: FormData,
): Promise<ImportResult<ImportReport>> {
  const actor = await requireStaff(["owner"]);
  const read = await readUpload(form);
  if (!read.ok) return read;
  const mapping = mappingSchema.safeParse(parseJsonField(form.get("mapping")));
  const groups = groupChoicesSchema.safeParse(
    parseJsonField(form.get("groups")),
  );
  if (!mapping.success || !groups.success)
    return { ok: false, error: "invalid" };
  const result = await commitImport(
    await createServerDb(),
    new Date(),
    actor,
    read.upload,
    mapping.data,
    groups.data,
  );
  if (result.ok && (result.data.created > 0 || result.data.groupsCreated > 0)) {
    // New clients show up in the lists, the counters of "Today" and the group screens.
    revalidatePath("/clients", "layout");
    revalidatePath("/today");
    revalidatePath("/groups", "layout");
    revalidatePath("/reminders");
  }
  return result;
}
