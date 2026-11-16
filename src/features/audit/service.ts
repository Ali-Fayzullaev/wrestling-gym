import { z } from "zod";

import type { Db } from "@/db/client";
import type { Json } from "@/db/types";

import { AUDIT_ACTIONS, type AuditAction } from "./actions";
import type { AuditEntry } from "./describe";
import type { AuditQuery } from "./schema";

/** Entries per page of the journal. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Records an action of the signed-in employee through write_audit(): the database takes the actor
 * from the session, so nobody writes on someone else's behalf. `details` holds ids, counts and
 * field names only, never names, phones, emails or free text. Writes inside SQL functions call
 * write_audit() (or insert) in the same transaction instead.
 */
export async function writeAudit(
  db: Db,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  details: Record<string, Json> = {},
): Promise<boolean> {
  const { error } = await db.rpc("write_audit", {
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId ?? undefined,
    p_details: details,
  });
  return error === null;
}

/**
 * Records an action as `actorId` with the service_role client, for the moments the employee has
 * no role in the database yet: signing in with a temporary password. Server only; the caller
 * passes the id Auth has just confirmed, never one from the request.
 */
export async function writeAuditAs(
  admin: Db,
  actorId: string,
  action: AuditAction,
  entity: string,
  entityId: string | null,
): Promise<boolean> {
  const { error } = await admin.from("audit_log").insert({
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
  });
  return error === null;
}

// Shape of audit_feed() (supabase/migrations/*_audit_settings_staff.sql), checked, not trusted.
const entryShape = z.object({
  id: z.string(),
  created_at: z.string(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  action: z.enum(AUDIT_ACTIONS),
  entity: z.string(),
  entity_id: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  client_id: z.string().nullable(),
  client_name: z.string().nullable(),
  group_name: z.string().nullable(),
  staff_name: z.string().nullable(),
});

const feedShape = z.object({
  entries: z.array(entryShape),
  staff: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type AuditFeed = {
  entries: AuditEntry[];
  staff: { id: string; name: string }[];
  /** The last entry of this page when there are older ones. */
  hasMore: boolean;
};

/** One page of the journal, newest first. Owner only: the database refuses anyone else. */
export async function getAuditFeed(
  db: Db,
  query: AuditQuery,
  pageSize: number = AUDIT_PAGE_SIZE,
): Promise<AuditFeed> {
  const { data, error } = await db.rpc("audit_feed", {
    p_actor: query.staff,
    p_action: query.action,
    p_from: query.from,
    p_to: query.to,
    p_before_at: query.cursor?.at,
    p_before_id: query.cursor?.id,
    p_limit: pageSize,
  });
  if (error) throw new Error(`audit_feed failed: ${error.code}`);
  const feed = feedShape.parse(data);
  const entries = feed.entries.slice(0, pageSize).map((row): AuditEntry => ({
    id: row.id,
    createdAt: row.created_at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    details: row.details,
    clientId: row.client_id,
    clientName: row.client_name,
    groupName: row.group_name,
    staffName: row.staff_name,
  }));
  return {
    entries,
    staff: feed.staff,
    hasMore: feed.entries.length > pageSize,
  };
}
