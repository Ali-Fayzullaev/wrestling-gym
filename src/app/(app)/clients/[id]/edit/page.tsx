import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientForm } from "@/features/clients/components/client-form";
import { clientIdSchema } from "@/features/clients/schema";
import { getClient } from "@/features/clients/service";
import { clientsText } from "@/i18n/clients";
import { ru } from "@/i18n/ru";
import { formatPhone } from "@/lib/phone";

import { checkPhoneAction, updateClientAction } from "../../actions";
import { BackLink } from "../../back-link";

export const metadata: Metadata = {
  title: `${clientsText.form.editTitle} | ${ru.app.name}`,
};

/** Two database requests: the role check and client_screen(). */
export default async function EditClientPage({
  params,
}: PageProps<"/clients/[id]/edit">) {
  await requireStaff(STAFF_ROLES);
  const id = clientIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const now = new Date();
  const screen = await getClient(await createServerDb(), now, id.data);
  if (!screen) notFound();
  const { client, group } = screen;

  return (
    <>
      <BackLink
        href={`/clients/${client.id}`}
        label={`${client.lastName} ${client.firstName}`}
      />
      <PageHeader title={clientsText.form.editTitle} />
      <ClientForm
        mode="edit"
        clientId={client.id}
        initial={{ ...client, phone: formatPhone(client.phone) }}
        groups={screen.groups}
        archivedGroup={
          group?.archived ? { id: group.id, name: group.name } : null
        }
        consentsOnFile={screen.consents}
        today={now}
        submit={updateClientAction.bind(null, client.id)}
        checkPhone={checkPhoneAction}
      />
    </>
  );
}
