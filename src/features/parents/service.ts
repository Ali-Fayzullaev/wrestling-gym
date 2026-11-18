import { z } from "zod";

import type { SubscriptionStatus } from "@/components/status-badge";
import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";
import { STATUSES } from "@/features/clients/filters";
import { businessDate } from "@/lib/dates";
import { type Locale, LOCALES } from "@/lib/locale";

import { PARENT_QUERY_MIN } from "./form-fields";
import type {
  ArchiveParentInput,
  DeleteParentInput,
  ParentInput,
} from "./schema";

export type ParentError =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "unavailable"
  /** STUB(D-23): archiving a parent whose children are still in work. */
  | "has_active_children"
  /** Deleting a parent who still has children, archived ones included. */
  | "has_children"
  | "confirmation_mismatch";

export type ParentResult<T> =
  { ok: true; data: T } | { ok: false; error: ParentError };

/** A parent as the picker on the client form lists it. */
export type ParentOption = {
  id: string;
  name: string;
  phone: string;
  messageLocale: Locale;
  /** First names of the parent's children, to tell namesakes apart; null when not loaded. */
  children: string[] | null;
};

export type ParentChild = {
  id: string;
  lastName: string;
  firstName: string;
  archived: boolean;
  status: SubscriptionStatus;
  endsOn: string | null;
  /** The child's active group; null without one. */
  groupName: string | null;
  /** The active group's monthly price, offered in the payment form. */
  price: number | null;
};

export type ParentScreen = {
  parent: {
    id: string;
    name: string;
    phone: string;
    messageLocale: Locale;
    note: string;
    archived: boolean;
  };
  /** Current children first, by first name. Each has its own subscription (D-19). */
  children: ParentChild[];
};

// Shapes of search_parents() / parent_screen() (supabase/migrations/*_families.sql), checked
// rather than trusted.
const locale = z.enum(LOCALES);

const optionShape = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  message_locale: locale,
  children: z.array(z.string()),
});

const screenShape = z.object({
  parent: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    message_locale: locale,
    note: z.string(),
    archived: z.boolean(),
  }),
  children: z.array(
    z.object({
      id: z.string(),
      last_name: z.string(),
      first_name: z.string(),
      archived: z.boolean(),
      status: z.enum(STATUSES),
      ends_on: z.string().nullable(),
      group_name: z.string().nullable(),
      price: z.number().nullable(),
    }),
  ),
});

const isStaff = (actor: Actor) =>
  actor.role === "owner" || actor.role === "admin";

// Refusals the screen explains in words of its own, by the exception's message.
const MESSAGE_ERRORS: Record<string, ParentError> = {
  parent_has_active_children: "has_active_children",
  parent_has_children: "has_children",
  confirmation_mismatch: "confirmation_mismatch",
};

/** Postgres errors raised by the parent functions, mapped to what the screen can say. */
function parentError(error: { code?: string; message?: string }): ParentError {
  const known = error.message ? MESSAGE_ERRORS[error.message] : undefined;
  if (known) return known;
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0002") return "not_found";
  if (
    error.code === "23514" ||
    error.code === "22023" ||
    error.code === "22P02"
  )
    return "invalid";
  return "unavailable";
}

function toOption(row: z.infer<typeof optionShape>): ParentOption {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    messageLocale: row.message_locale,
    children: row.children,
  };
}

/** Current parents whose name or phone contains the text; a too short text finds nobody. */
export async function searchParents(
  db: Db,
  actor: Actor,
  query: string,
): Promise<ParentResult<ParentOption[]>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  if (query.trim().length < PARENT_QUERY_MIN) return { ok: true, data: [] };
  // The text goes in the request body (an RPC), never in a URL: it may be a name or a phone.
  const { data, error } = await db.rpc("search_parents", { p_query: query });
  if (error) return { ok: false, error: parentError(error) };
  return { ok: true, data: z.array(optionShape).parse(data).map(toOption) };
}

/** One current parent for the picker (the "another child of this parent" link), or null. */
export async function getParentOption(
  db: Db,
  parentId: string,
): Promise<ParentOption | null> {
  const { data, error } = await db
    .from("parents")
    .select("id, name, phone, message_locale, clients(first_name, deleted_at)")
    .eq("id", parentId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(`parents failed: ${error.code}`);
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    phone: data.phone,
    messageLocale: locale.parse(data.message_locale),
    children: data.clients
      .filter((child) => child.deleted_at === null)
      .map((child) => child.first_name),
  };
}

/** The parent's card: the parent and the children with status, in one database request. */
export async function getParent(
  db: Db,
  now: Date,
  parentId: string,
): Promise<ParentScreen | null> {
  const { data, error } = await db.rpc("parent_screen", {
    p_parent_id: parentId,
    p_today: businessDate(now),
  });
  if (error) throw new Error(`parent_screen failed: ${error.code}`);
  if (data === null) return null;
  const screen = screenShape.parse(data);
  return {
    parent: {
      id: screen.parent.id,
      name: screen.parent.name,
      phone: screen.parent.phone,
      messageLocale: screen.parent.message_locale,
      note: screen.parent.note,
      archived: screen.parent.archived,
    },
    children: screen.children.map((child) => ({
      id: child.id,
      lastName: child.last_name,
      firstName: child.first_name,
      archived: child.archived,
      status: child.status,
      endsOn: child.ends_on,
      groupName: child.group_name,
      price: child.price,
    })),
  };
}

/** Saves name, phone, language and note, with an audit row naming the changed fields. */
export async function updateParent(
  db: Db,
  actor: Actor,
  parentId: string,
  input: ParentInput,
): Promise<ParentResult<null>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { error } = await db.rpc("update_parent", {
    p_parent_id: parentId,
    p_name: input.name,
    p_phone: input.phone,
    p_message_locale: input.messageLocale,
    p_note: input.note,
  });
  if (error) return { ok: false, error: parentError(error) };
  return { ok: true, data: null };
}

/**
 * Archives or brings back a parent; repeating it changes nothing. STUB(D-23): the database refuses
 * a parent whose children are not all in the archive.
 */
export async function setParentArchived(
  db: Db,
  actor: Actor,
  input: ArchiveParentInput,
): Promise<ParentResult<{ changed: boolean }>> {
  if (!isStaff(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("set_parent_archived", {
    p_parent_id: input.parentId,
    p_archived: input.archived,
  });
  if (error) return { ok: false, error: parentError(error) };
  return { ok: true, data: { changed: data } };
}

/** Owner only: deletes a parent without children, with the reason in the audit log. */
export async function deleteParent(
  db: Db,
  actor: Actor,
  input: DeleteParentInput,
): Promise<ParentResult<null>> {
  if (actor.role !== "owner") return { ok: false, error: "forbidden" };
  const { error } = await db.rpc("delete_parent", {
    p_parent_id: input.parentId,
    p_reason: input.reason,
    p_name: input.name,
  });
  if (error) return { ok: false, error: parentError(error) };
  return { ok: true, data: null };
}
