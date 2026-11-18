import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientForm } from "@/features/clients/components/client-form";
import { listActiveGroups } from "@/features/clients/service";
import { parentIdSchema } from "@/features/parents/schema";
import { getParentOption } from "@/features/parents/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";
import { businessDate } from "@/lib/dates";
import { DEFAULT_LOCALE } from "@/lib/locale";

import {
  checkPhoneAction,
  createClientAction,
  searchParentsAction,
} from "../actions";
import { BackLink } from "@/components/back-link";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.clientForm.createTitle} | ${t.app.name}` };
}

/**
 * Two database requests: the role check and the active groups; three with ?parent=<uuid> ("another
 * child of this parent"), which also loads that parent so the form opens as a child of theirs.
 */
export default async function NewClientPage({
  searchParams,
}: PageProps<"/clients/new">) {
  const { t: messages } = await getI18n();
  const clientsText = messages.clients;
  await requireStaff(STAFF_ROLES);
  const now = new Date();
  const db = await createServerDb();
  const parentId = parentIdSchema.safeParse((await searchParams).parent);
  const [groups, parent] = await Promise.all([
    listActiveGroups(db),
    parentId.success ? getParentOption(db, parentId.data) : null,
  ]);

  return (
    <>
      <BackLink href="/clients" label={clientsText.back} />
      <PageHeader title={messages.clientForm.createTitle} />
      <Texts ns={["clientForm", "clients"]}>
        <ClientForm
          mode="create"
          clientId={null}
          initial={{
            lastName: "",
            firstName: "",
            birthDate: null,
            phone: "",
            kind: parent ? "child" : "adult",
            parent,
            groupId: null,
            startedOn: businessDate(now),
            note: "",
            messageLocale: DEFAULT_LOCALE,
          }}
          groups={groups}
          archivedGroup={null}
          consentsOnFile={[]}
          today={now}
          submit={createClientAction}
          checkPhone={checkPhoneAction}
          searchParents={searchParentsAction}
        />
      </Texts>
    </>
  );
}
