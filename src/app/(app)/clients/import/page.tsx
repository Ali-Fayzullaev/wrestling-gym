import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/features/auth/require-staff";
import { ImportWizard } from "@/features/import/components/import-wizard";
import { clientsText } from "@/i18n/clients";
import { importText } from "@/i18n/import";
import { ru } from "@/i18n/ru";

import { commitImportAction, previewImportAction } from "./actions";

export const metadata: Metadata = {
  title: `${ru.pages.clientImport} | ${ru.app.name}`,
};

/**
 * Import from the notebook (step 10). Owner only, here and in the proxy. One database request
 * on open (the role check); the file is read on the server when it is chosen.
 */
export default async function ClientImportPage() {
  await requireStaff(["owner"]);
  return (
    <>
      <BackLink href="/clients" label={clientsText.back} />
      <PageHeader
        title={importText.title}
        description={importText.description}
      />
      <ImportWizard
        today={new Date()}
        preview={previewImportAction}
        commit={commitImportAction}
      />
    </>
  );
}
