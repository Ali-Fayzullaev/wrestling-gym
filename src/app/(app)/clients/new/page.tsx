import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientForm } from "@/features/clients/components/client-form";
import { listActiveGroups } from "@/features/clients/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";
import { businessDate } from "@/lib/dates";
import { DEFAULT_LOCALE } from "@/lib/locale";

import { checkPhoneAction, createClientAction } from "../actions";
import { BackLink } from "@/components/back-link";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.clientForm.createTitle} | ${t.app.name}` };
}

/** Two database requests: the role check and the active groups. */
export default async function NewClientPage() {
  const { t: messages } = await getI18n();
  const clientsText = messages.clients;
  await requireStaff(STAFF_ROLES);
  const now = new Date();
  const groups = await listActiveGroups(await createServerDb());

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
            phoneOwner: "self",
            parentName: null,
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
        />
      </Texts>
    </>
  );
}
