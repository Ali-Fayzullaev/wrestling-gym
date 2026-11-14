import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientForm } from "@/features/clients/components/client-form";
import { listActiveGroups } from "@/features/clients/service";
import { clientsText } from "@/i18n/clients";
import { ru } from "@/i18n/ru";
import { businessDate } from "@/lib/dates";

import { checkPhoneAction, createClientAction } from "../actions";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = {
  title: `${clientsText.form.createTitle} | ${ru.app.name}`,
};

/** Two database requests: the role check and the active groups. */
export default async function NewClientPage() {
  await requireStaff(STAFF_ROLES);
  const now = new Date();
  const groups = await listActiveGroups(await createServerDb());

  return (
    <>
      <BackLink href="/clients" label={clientsText.back} />
      <PageHeader title={clientsText.form.createTitle} />
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
        }}
        groups={groups}
        archivedGroup={null}
        consentsOnFile={[]}
        today={now}
        submit={createClientAction}
        checkPhone={checkPhoneAction}
      />
    </>
  );
}
