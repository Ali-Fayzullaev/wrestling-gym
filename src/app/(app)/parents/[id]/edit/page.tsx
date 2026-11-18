import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ParentForm } from "@/features/parents/components/parent-form";
import { parentIdSchema } from "@/features/parents/schema";
import { getParent } from "@/features/parents/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";
import { formatPhone } from "@/lib/phone";

import { updateParentAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.parents.editTitle} | ${t.app.name}` };
}

/** Two database requests: the role check and parent_screen(). */
export default async function EditParentPage({
  params,
}: PageProps<"/parents/[id]/edit">) {
  const { t } = await getI18n();
  await requireStaff(STAFF_ROLES);
  const id = parentIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const screen = await getParent(await createServerDb(), new Date(), id.data);
  if (!screen) notFound();
  const { parent } = screen;

  return (
    <>
      <BackLink href={`/parents/${parent.id}`} label={parent.name} />
      <PageHeader title={t.parents.editTitle} />
      <Texts ns={["parents"]}>
        <ParentForm
          parentId={parent.id}
          initial={{
            name: parent.name,
            phone: formatPhone(parent.phone),
            messageLocale: parent.messageLocale,
            note: parent.note,
          }}
          submit={updateParentAction.bind(null, parent.id)}
        />
      </Texts>
    </>
  );
}
