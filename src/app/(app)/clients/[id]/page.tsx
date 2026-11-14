import { Archive, BellRing, Pencil, TriangleAlert, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/variants";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { ClientActions } from "@/features/clients/components/client-actions";
import { CONSENT_KINDS } from "@/features/clients/form-fields";
import { clientIdSchema } from "@/features/clients/schema";
import { getClient } from "@/features/clients/service";
import { clientsText } from "@/i18n/clients";
import { ru } from "@/i18n/ru";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

import { deleteClientAction, setClientArchivedAction } from "../actions";
import { BackLink } from "../back-link";

const c = clientsText.card;

export const metadata: Metadata = {
  title: `${ru.pages.clients} | ${ru.app.name}`,
};

/** Two database requests: the role check and client_screen(). */
export default async function ClientPage({
  params,
}: PageProps<"/clients/[id]">) {
  const actor = await requireStaff(STAFF_ROLES);
  const id = clientIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const now = new Date();
  const screen = await getClient(await createServerDb(), now, id.data);
  if (!screen) notFound();
  const { client, group, subscription, consents } = screen;
  const consentByKind = new Map(
    consents.map((consent) => [consent.kind, consent]),
  );

  return (
    <>
      <BackLink href="/clients" label={clientsText.back} />
      <PageHeader
        title={`${client.lastName} ${client.firstName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/clients/${client.id}/edit`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Pencil aria-hidden />
              {clientsText.edit}
            </Link>
            <ClientActions
              clientId={client.id}
              lastName={client.lastName}
              archived={client.archived}
              canDelete={actor.role === "owner"}
              setArchived={setClientArchivedAction}
              remove={deleteClientAction}
            />
          </div>
        }
      />
      {client.archived ? (
        <p
          className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-3 text-sm"
          data-testid="client-archived"
        >
          <Archive aria-hidden className="size-4 shrink-0" />
          {c.archivedNotice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={c.subscription}>
          <div className="flex flex-col gap-2">
            <StatusBadge status={subscription.status} />
            {subscription.endsOn && subscription.periodStart ? (
              <>
                <dl className="grid gap-2 text-sm">
                  <Row label={c.period}>
                    <DateText date={subscription.periodStart} today={now} /> –{" "}
                    <DateText date={subscription.endsOn} today={now} />
                  </Row>
                </dl>
                {subscription.daysLeft !== null ? (
                  <p className="text-sm text-muted-foreground">
                    {c.daysLeft(subscription.daysLeft)}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{c.noPayments}</p>
            )}
          </div>
        </Section>

        <Section title={c.group}>
          {group ? (
            <div className="grid gap-2 text-sm">
              <Link
                href={`/groups/${group.id}`}
                className="w-fit font-medium underline-offset-4 hover:underline"
              >
                {group.name}
              </Link>
              <p className="text-muted-foreground">
                {c.coach}: {group.coachName}
              </p>
              {group.archived ? (
                <div
                  className="grid gap-2 rounded-md bg-status-expiring px-3 py-2 text-status-expiring-foreground"
                  data-testid="group-archived"
                >
                  <p className="flex items-start gap-2">
                    <TriangleAlert
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0"
                    />
                    {c.groupArchived}
                  </p>
                  <Link
                    href={`/clients/${client.id}/edit`}
                    className="w-fit font-medium underline underline-offset-4"
                  >
                    {c.moveToGroup}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{c.noGroup}</p>
          )}
        </Section>

        <Section title={c.contacts}>
          <dl className="grid gap-2 text-sm">
            <Row label={c.phone}>
              <span className="tabular-nums">{formatPhone(client.phone)}</span>
              {" · "}
              {client.phoneOwner === "parent"
                ? c.phoneOwnerParent
                : c.phoneOwnerSelf}
            </Row>
            {client.parentName ? (
              <Row label={c.parentName}>{client.parentName}</Row>
            ) : null}
            {client.birthDate ? (
              <Row label={c.birthDate}>
                <DateText date={client.birthDate} today={now} />
              </Row>
            ) : null}
            <Row label={c.startedOn}>
              <DateText date={client.startedOn} today={now} />
            </Row>
          </dl>
        </Section>

        <Section title={c.consents}>
          <dl className="grid gap-2 text-sm">
            {CONSENT_KINDS.map((kind) => {
              const consent = consentByKind.get(kind);
              return (
                <Row key={kind} label={clientsText.form.consentKinds[kind]}>
                  {consent ? (
                    c.consentGiven(
                      formatDate(consent.givenOn, now),
                      consent.recordedBy,
                    )
                  ) : (
                    <span className="text-status-expired-foreground">
                      {c.consentMissing}
                    </span>
                  )}
                </Row>
              );
            })}
          </dl>
        </Section>

        <Section title={c.note} className="lg:col-span-2">
          <p className="text-sm break-words whitespace-pre-line">
            {client.note || (
              <span className="text-muted-foreground">{c.noNote}</span>
            )}
          </p>
        </Section>
      </div>

      {/* Filled by step 07 (payments) and step 09 (reminders). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="payments-title"
          className="flex flex-col gap-3"
        >
          <h2 id="payments-title" className="text-lg font-semibold">
            {c.payments}
          </h2>
          <EmptyState
            icon={Wallet}
            title={c.paymentsEmpty}
            description={c.paymentsEmptyText}
          />
        </section>
        <section
          aria-labelledby="reminders-title"
          className="flex flex-col gap-3"
        >
          <h2 id="reminders-title" className="text-lg font-semibold">
            {c.reminders}
          </h2>
          <EmptyState
            icon={BellRing}
            title={c.remindersEmpty}
            description={c.remindersEmptyText}
          />
        </section>
      </div>
    </>
  );
}

function Section({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${className}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
