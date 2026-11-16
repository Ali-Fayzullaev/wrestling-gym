import { Archive, ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DateText } from "@/components/date-text";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { GroupOwnerActions } from "@/features/groups/components/group-owner-actions";
import {
  MEMBER_CHECKBOX,
  MemberSelection,
} from "@/features/groups/components/member-selection";
import {
  formatSchedule,
  formatSeats,
  seatState,
} from "@/features/groups/format";
import { groupIdSchema } from "@/features/groups/schema";
import { getGroup, type GroupMember } from "@/features/groups/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import {
  archiveGroupAction,
  moveClientsAction,
  updateGroupAction,
} from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.groups} | ${t.app.name}` };
}

/** Two database requests: the role check and group_screen(). */
export default async function GroupPage({ params }: PageProps<"/groups/[id]">) {
  const { t: messages, locale } = await getI18n();
  const groupsText = messages.groups;
  const actor = await requireStaff(STAFF_ROLES);
  const id = groupIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const now = new Date();
  const screen = await getGroup(await createServerDb(), now, id.data);
  if (!screen) notFound();

  const { group, members, targets, coaches } = screen;
  const canManage = actor.role === "owner" && !group.archived;
  const canMove = !group.archived && members.length > 0;

  return (
    <Texts ns={["groups", "status"]}>
      <Link
        href="/groups"
        className="-mb-3 flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {messages.pages.groups}
      </Link>
      <PageHeader
        title={group.name}
        description={`${group.coachName} · ${formatSchedule(group.schedule, groupsText)}`}
        actions={
          canManage ? (
            <GroupOwnerActions
              groupId={group.id}
              values={{
                name: group.name,
                coachId: group.coachId,
                schedule: group.schedule,
                defaultPrice: group.defaultPrice,
                capacity: group.capacity,
              }}
              members={group.members}
              coaches={coaches}
              update={updateGroupAction.bind(null, group.id)}
              archive={archiveGroupAction}
            />
          ) : null
        }
      />
      {group.archived ? (
        <p className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-3 text-sm">
          <Archive aria-hidden className="size-4 shrink-0" />
          {groupsText.archivedNotice}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={groupsText.members}
          value={formatSeats(group.members, group.capacity)}
          warn={seatState(group.members, group.capacity) === "over"}
          testId="stat-members"
        />
        <Stat label={groupsText.paid} value={group.paid} testId="stat-paid" />
        <Stat
          label={groupsText.debtors}
          value={group.debtors}
          testId="stat-debtors"
        />
        <Stat
          label={groupsText.unpaid}
          value={group.unpaid}
          testId="stat-unpaid"
        />
      </dl>
      <p className="-mt-3 text-sm text-muted-foreground">
        {groupsText.price}:{" "}
        <Money locale={locale} amount={group.defaultPrice} />
        {group.capacity === null
          ? ` · ${groupsText.seats}: ${groupsText.seatsUnlimited}`
          : null}
      </p>

      <section aria-labelledby="members-title" className="flex flex-col gap-3">
        <h2 id="members-title" className="text-lg font-semibold">
          {groupsText.membersTitle}
        </h2>
        {members.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {groupsText.membersEmpty}
          </p>
        ) : canMove ? (
          <MemberSelection
            total={members.length}
            targets={targets}
            move={moveClientsAction}
          >
            <MemberList members={members} now={now} selectable />
          </MemberSelection>
        ) : (
          <MemberList members={members} now={now} selectable={false} />
        )}
      </section>
    </Texts>
  );
}

function Stat({
  label,
  value,
  warn = false,
  testId,
}: {
  label: string;
  value: number | string;
  warn?: boolean;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${warn ? "text-status-expiring-foreground" : ""}`}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

/** Rows are server-rendered; MemberSelection only reads their checkboxes. */
async function MemberList({
  members,
  now,
  selectable,
}: {
  members: GroupMember[];
  now: Date;
  selectable: boolean;
}) {
  const { t: messages, locale } = await getI18n();
  const groupsText = messages.groups;
  return (
    <ul className="flex flex-col divide-y rounded-xl border bg-card">
      {members.map((member) => {
        const body = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium break-words">
                {member.lastName} {member.firstName}
              </span>
              {member.endsOn ? (
                <span className="text-sm text-muted-foreground">
                  {groupsText.endsOnPrefix}{" "}
                  <DateText locale={locale} date={member.endsOn} today={now} />
                </span>
              ) : null}
            </span>
            <StatusBadge
              status={member.status}
              label={messages.status[member.status]}
            />
          </>
        );
        return (
          <li key={member.id} data-testid="group-member">
            {selectable ? (
              <label className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/50 has-checked:bg-accent">
                <input
                  type="checkbox"
                  name={MEMBER_CHECKBOX}
                  value={member.id}
                  className="size-5 shrink-0 accent-primary"
                />
                {body}
              </label>
            ) : (
              <div className="flex min-h-16 items-center gap-3 px-4 py-3">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
