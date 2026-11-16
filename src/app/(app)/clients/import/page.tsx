import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/features/auth/require-staff";
import { ImportWizard } from "@/features/import/components/import-wizard";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { commitImportAction, previewImportAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.clientImport} | ${t.app.name}` };
}

/**
 * Import from the notebook (step 10). Owner only, here and in the proxy. One database request
 * on open (the role check); the file is read on the server when it is chosen.
 */
export default async function ClientImportPage() {
  const { t: messages } = await getI18n();
  const clientsText = messages.clients;
  const importText = messages.importUpload;
  await requireStaff(["owner"]);
  return (
    <>
      <BackLink href="/clients" label={clientsText.back} />
      <PageHeader
        title={importText.title}
        description={importText.description}
      />
      {/* The preview's texts come along: they are data in the page, not JavaScript. */}
      <Texts ns={["importUpload", "import", "status"]}>
        <ImportWizard
          today={new Date()}
          preview={previewImportAction}
          commit={commitImportAction}
        />
      </Texts>
    </>
  );
}
