import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientForm } from "@/features/clients/components/client-form";
import { clientIdSchema } from "@/features/clients/schema";
import { getClient } from "@/features/clients/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";
import { formatPhone } from "@/lib/phone";

import { checkPhoneAction, updateClientAction } from "../../actions";
import { BackLink } from "@/components/back-link";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.clientForm.editTitle} | ${t.app.name}` };
}

/** Two database requests: the role check and client_screen(). */
export default async function EditClientPage({
  params,
}: PageProps<"/clients/[id]/edit">) {
  const { t: messages } = await getI18n();
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
      <PageHeader title={messages.clientForm.editTitle} />
      <Texts ns={["clientForm", "clients"]}>
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
      </Texts>
    </>
  );
}
