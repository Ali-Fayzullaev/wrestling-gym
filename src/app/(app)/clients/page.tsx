import { Plus, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/variants";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientsList } from "@/features/clients/components/clients-list";
import { filtersToSearch, parseFilters } from "@/features/clients/filters";
import { listClients } from "@/features/clients/service";
import { fmt } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";

import { cancelPaymentAction, recordPaymentAction } from "./payment-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.pages.clients} | ${t.app.name}` };
}

/** Two database requests: the role check and clients_screen(). Everything else runs in the browser. */
export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
  const { t: messages } = await getI18n();
  const clientsText = messages.clients;
  const actor = await requireStaff(STAFF_ROLES);
  const now = new Date();
  const [screen, params] = await Promise.all([
    listClients(await createServerDb(), now),
    searchParams,
  ]);
  const filters = parseFilters(params);
  const createButton = (
    <div className="flex flex-wrap gap-2">
      {actor.role === "owner" ? (
        <Link
          href="/clients/import"
          className={buttonVariants({ variant: "outline" })}
        >
          <Upload aria-hidden />
          {messages.importUpload.open}
        </Link>
      ) : null}
      <Link href="/clients/new" className={buttonVariants()}>
        <Plus aria-hidden />
        {clientsText.create}
      </Link>
    </div>
  );

  return (
    <>
      <PageHeader
        title={messages.pages.clients}
        mascot="hello"
        actions={createButton}
      />
      {screen.total === 0 ? (
        <EmptyState
          mood="hello"
          title={messages.clientsList.emptyTitle}
          description={messages.clientsList.emptyText}
        />
      ) : (
        <>
          {screen.total > screen.clients.length ? (
            <p className="rounded-xl border bg-muted px-4 py-3 text-sm">
              {fmt(messages.clientsList.truncated, {
                shown: screen.clients.length,
                total: screen.total,
              })}
            </p>
          ) : null}
          <Texts ns={["clientsList", "payments"]}>
            <ClientsList
              // A link with other filters (back button, shared link) starts the list afresh.
              key={filtersToSearch(filters)}
              rows={screen.clients}
              groups={screen.groups}
              coaches={screen.coaches}
              initialFilters={filters}
              today={now}
              recordPayment={recordPaymentAction}
              cancelPayment={cancelPaymentAction}
            />
          </Texts>
        </>
      )}
    </>
  );
}
