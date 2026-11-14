import { Plus, Upload, UserRound } from "lucide-react";
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
import { clientsText } from "@/i18n/clients";
import { importText } from "@/i18n/import";
import { ru } from "@/i18n/ru";

import { cancelPaymentAction, recordPaymentAction } from "./payment-actions";

export const metadata: Metadata = {
  title: `${ru.pages.clients} | ${ru.app.name}`,
};

/** Two database requests: the role check and clients_screen(). Everything else runs in the browser. */
export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
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
          {importText.open}
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
      <PageHeader title={ru.pages.clients} actions={createButton} />
      {screen.total === 0 ? (
        <EmptyState
          icon={UserRound}
          title={clientsText.list.emptyTitle}
          description={clientsText.list.emptyText}
        />
      ) : (
        <>
          {screen.total > screen.clients.length ? (
            <p className="rounded-xl border bg-muted px-4 py-3 text-sm">
              {clientsText.list.truncated(screen.clients.length, screen.total)}
            </p>
          ) : null}
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
        </>
      )}
    </>
  );
}
