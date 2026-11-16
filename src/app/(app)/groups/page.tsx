import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { CreateGroupButton } from "@/features/groups/components/create-group-button";
import { GroupCard } from "@/features/groups/components/group-card";
import { listGroups } from "@/features/groups/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { createGroupAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.groups} | ${t.app.name}` };
}

/** Two database requests: the role check and groups_screen(). */
export default async function GroupsPage() {
  const { t: messages } = await getI18n();
  const groupsText = messages.groups;
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
    <Texts ns={["groups"]}>
      <PageHeader
        title={messages.pages.groups}
        mascot="ok"
        actions={createButton}
      />
      {groups.length === 0 ? (
        <EmptyState
          mood="hello"
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
    </Texts>
  );
}
