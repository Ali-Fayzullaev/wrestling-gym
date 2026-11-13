import { z } from "zod";

import type { Db } from "@/db/client";
import type { Actor } from "@/features/auth/roles";
import { businessDate } from "@/lib/dates";

import type {
  ArchiveGroupInput,
  GroupInput,
  MoveClientsInput,
  Session,
} from "./schema";

export type GroupError =
  | "forbidden"
  | "not_found"
  | "coach_not_found"
  | "target_not_found"
  | "client_not_found"
  | "invalid"
  | "unavailable";

export type Result<T> =
  { ok: true; data: T } | { ok: false; error: GroupError };

// Shapes of groups_screen() / group_screen() (supabase/migrations/*_groups_management.sql).
// The database returns jsonb, so the reply is checked rather than trusted.
const sessionShape = z.object({
  day: z.number(),
  start: z.string(),
  end: z.string(),
});

const countsShape = {
  members: z.number(),
  paid: z.number(),
  expiring: z.number(),
  debtors: z.number(),
  unpaid: z.number(),
};

const groupShape = z.object({
  id: z.string(),
  name: z.string(),
  coach_id: z.string(),
  coach_name: z.string(),
  schedule: z.array(sessionShape),
  default_price: z.number(),
  capacity: z.number().nullable(),
  ...countsShape,
});

const coachShape = z.object({ id: z.string(), name: z.string() });

const groupsScreenShape = z.object({
  groups: z.array(groupShape),
  coaches: z.array(coachShape),
});

const groupScreenShape = z.object({
  group: groupShape.extend({ archived: z.boolean() }),
  members: z.array(
    z.object({
      id: z.string(),
      last_name: z.string(),
      first_name: z.string(),
      status: z.enum(["active", "expiring", "expired", "none"]),
      ends_on: z.string().nullable(),
    }),
  ),
  targets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      capacity: z.number().nullable(),
      members: z.number(),
    }),
  ),
  coaches: z.array(coachShape),
});

export type Coach = { id: string; name: string };

export type GroupCounts = {
  members: number;
  /** Subscription valid today (active or expiring). */
  paid: number;
  expiring: number;
  /** Subscription has ended. */
  debtors: number;
  /** Never paid. */
  unpaid: number;
};

export type GroupSummary = GroupCounts & {
  id: string;
  name: string;
  coachId: string;
  coachName: string;
  schedule: Session[];
  defaultPrice: number;
  capacity: number | null;
};

export type GroupMember = {
  id: string;
  lastName: string;
  firstName: string;
  status: "active" | "expiring" | "expired" | "none";
  endsOn: string | null;
};

export type MoveTarget = {
  id: string;
  name: string;
  capacity: number | null;
  members: number;
};

export type GroupsScreen = { groups: GroupSummary[]; coaches: Coach[] };

export type GroupScreen = {
  group: GroupSummary & { archived: boolean };
  members: GroupMember[];
  targets: MoveTarget[];
  coaches: Coach[];
};

function toSummary(row: z.infer<typeof groupShape>): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    coachId: row.coach_id,
    coachName: row.coach_name,
    schedule: row.schedule,
    defaultPrice: row.default_price,
    capacity: row.capacity,
    members: row.members,
    paid: row.paid,
    expiring: row.expiring,
    debtors: row.debtors,
    unpaid: row.unpaid,
  };
}

/** Active groups with counts and the coach list: one database request. */
export async function listGroups(db: Db, now: Date): Promise<GroupsScreen> {
  const { data, error } = await db.rpc("groups_screen", {
    p_today: businessDate(now),
  });
  if (error) throw new Error(`groups_screen failed: ${error.code}`);
  const screen = groupsScreenShape.parse(data);
  return { groups: screen.groups.map(toSummary), coaches: screen.coaches };
}

/** One group with its clients, transfer targets and coaches, or null: one database request. */
export async function getGroup(
  db: Db,
  now: Date,
  groupId: string,
): Promise<GroupScreen | null> {
  const { data, error } = await db.rpc("group_screen", {
    p_group_id: groupId,
    p_today: businessDate(now),
  });
  if (error) throw new Error(`group_screen failed: ${error.code}`);
  if (data === null) return null;
  const screen = groupScreenShape.parse(data);
  return {
    group: { ...toSummary(screen.group), archived: screen.group.archived },
    members: screen.members.map((member) => ({
      id: member.id,
      lastName: member.last_name,
      firstName: member.first_name,
      status: member.status,
      endsOn: member.ends_on,
    })),
    targets: screen.targets,
    coaches: screen.coaches,
  };
}

/** Postgres errors raised by the group functions, mapped to what the screen can say. */
function groupError(error: { code?: string; message?: string }): GroupError {
  if (error.code === "42501") return "forbidden";
  if (error.code === "P0002") {
    switch (error.message) {
      case "coach_not_found":
        return "coach_not_found";
      case "target_group_not_found":
        return "target_not_found";
      case "client_not_found":
        return "client_not_found";
      default:
        return "not_found";
    }
  }
  // Check constraints and invalid input: the server-side Zod check should have caught these.
  if (
    error.code === "23514" ||
    error.code === "22023" ||
    error.code === "22P02"
  )
    return "invalid";
  return "unavailable";
}

function groupArgs(input: GroupInput) {
  return {
    p_name: input.name,
    p_coach_id: input.coachId,
    p_schedule: input.schedule,
    p_default_price: input.defaultPrice,
    ...(input.capacity === null ? {} : { p_capacity: input.capacity }),
  };
}

const ownerOnly = (actor: Actor) => actor.role === "owner";

export async function createGroup(
  db: Db,
  actor: Actor,
  input: GroupInput,
): Promise<Result<{ id: string }>> {
  if (!ownerOnly(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db.rpc("create_group", groupArgs(input));
  if (error) return { ok: false, error: groupError(error) };
  return { ok: true, data: { id: data } };
}

/** A new default price is used for payments from now on; recorded payments keep their amounts. */
export async function updateGroup(
  db: Db,
  actor: Actor,
  groupId: string,
  input: GroupInput,
): Promise<Result<null>> {
  if (!ownerOnly(actor)) return { ok: false, error: "forbidden" };
  const { error } = await db.rpc("update_group", {
    p_group_id: groupId,
    ...groupArgs(input),
  });
  if (error) return { ok: false, error: groupError(error) };
  return { ok: true, data: null };
}

export type ArchiveOutcome =
  | { archived: true }
  /** Nothing changed: the group still has clients and the owner has not confirmed. */
  | { archived: false; activeClients: number };

export async function archiveGroup(
  db: Db,
  actor: Actor,
  input: ArchiveGroupInput,
): Promise<Result<ArchiveOutcome>> {
  if (!ownerOnly(actor)) return { ok: false, error: "forbidden" };
  const { data, error } = await db
    .rpc("archive_group", { p_group_id: input.groupId, p_force: input.force })
    .single();
  if (error) return { ok: false, error: groupError(error) };
  return {
    ok: true,
    data: data.archived
      ? { archived: true }
      : { archived: false, activeClients: data.active_clients },
  };
}

export type MoveOutcome = {
  moved: number;
  targetMembers: number;
  targetCapacity: number | null;
};

/**
 * Moves clients to another group, all or none, with an audit row per client. Admins may do it:
 * it changes clients, not the group. Over-capacity is allowed; the screen warns beforehand.
 */
export async function moveClients(
  db: Db,
  actor: Actor,
  input: MoveClientsInput,
): Promise<Result<MoveOutcome>> {
  if (actor.role !== "owner" && actor.role !== "admin")
    return { ok: false, error: "forbidden" };
  const { data, error } = await db
    .rpc("move_clients", {
      p_client_ids: input.clientIds,
      p_target_group_id: input.targetGroupId,
    })
    .single();
  if (error) return { ok: false, error: groupError(error) };
  return {
    ok: true,
    data: {
      moved: data.moved,
      targetMembers: data.target_members,
      // The generated type cannot know the column may be null (no seat limit).
      targetCapacity: data.target_capacity ?? null,
    },
  };
}
