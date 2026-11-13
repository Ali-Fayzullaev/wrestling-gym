import { UsersRound } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { CreateGroupButton } from "@/features/groups/components/create-group-button";
import { GroupCard } from "@/features/groups/components/group-card";
import { listGroups } from "@/features/groups/service";
import { groupsText } from "@/i18n/groups";
import { ru } from "@/i18n/ru";

import { createGroupAction } from "./actions";

export const metadata: Metadata = {
  title: `${ru.pages.groups} | ${ru.app.name}`,
};

/** Two database requests: the role check and groups_screen(). */
export default async function GroupsPage() {
  const actor = await requireStaff(STAFF_ROLES);
  const { groups, coaches } = await listGroups(
    await createServerDb(),
    new Date(),
  );
  const isOwner = actor.role === "owner";
  const createButton = isOwner ? (
    <CreateGroupButton coaches={coaches} create={createGroupAction} />
  ) : null;

  return (
    <>
      <PageHeader title={ru.pages.groups} actions={createButton} />
      {groups.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={groupsText.emptyTitle}
          description={isOwner ? groupsText.emptyOwner : groupsText.emptyAdmin}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <li key={group.id}>
              <GroupCard group={group} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
