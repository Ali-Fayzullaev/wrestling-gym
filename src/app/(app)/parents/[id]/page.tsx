import { Archive, Pencil, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BackLink } from "@/components/back-link";
import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/variants";
import { createServerDb } from "@/db/server";
import { requireStaff } from "@/features/auth/require-staff";
import { STAFF_ROLES } from "@/features/auth/roles";
import { PayButton } from "@/features/payments/components/pay-button";
import { ParentActions } from "@/features/parents/components/parent-actions";
import { parentIdSchema } from "@/features/parents/schema";
import { getParent, type ParentChild } from "@/features/parents/service";
import { getI18n } from "@/i18n/server";
import { Texts } from "@/i18n/texts";
import { HTML_LANG, type Locale, LOCALE_NAMES } from "@/lib/locale";
import { formatPhone } from "@/lib/phone";

import {
  cancelPaymentAction,
  recordPaymentAction,
} from "../../clients/payment-actions";
import { deleteParentAction, setParentArchivedAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.parents.title} | ${t.app.name}` };
}

/**
 * A parent and their children, each with status and "Paid" (D-19: payments stay per child), and
 * the parent's archive and deletion. Two database requests: the role check and parent_screen().
 */
export default async function ParentPage({
  params,
}: PageProps<"/parents/[id]">) {
  const { t: messages, locale } = await getI18n();
  const p = messages.parents;
  const actor = await requireStaff(STAFF_ROLES);
  const id = parentIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const now = new Date();
  const screen = await getParent(await createServerDb(), now, id.data);
  if (!screen) notFound();
  const { parent, children } = screen;

  return (
    <Texts ns={["payments", "parents"]}>
      <BackLink href="/clients" label={messages.clients.back} />
      <PageHeader
        title={parent.name}
        description={p.subtitle}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/parents/${parent.id}/edit`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Pencil aria-hidden />
              {p.edit}
            </Link>
            {parent.archived ? null : (
              <Link
                href={`/clients/new?parent=${parent.id}`}
                className={buttonVariants({ variant: "outline" })}
                data-testid="add-child"
              >
                <UserPlus aria-hidden />
                {p.addChild}
              </Link>
            )}
            <ParentActions
              parentId={parent.id}
              name={parent.name}
              archived={parent.archived}
              canDelete={actor.role === "owner"}
              setArchived={setParentArchivedAction}
              remove={deleteParentAction}
            />
          </div>
        }
      />
      {parent.archived ? (
        <p
          className="flex items-center gap-2 rounded-xl border bg-muted px-4 py-3 text-sm"
          data-testid="parent-archived"
        >
          <Archive aria-hidden className="size-4 shrink-0" />
          {p.archivedNotice}
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">{p.contacts}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={p.phone}>
            <span className="tabular-nums">{formatPhone(parent.phone)}</span>
          </Row>
          <Row label={p.messageLocale}>
            <span lang={HTML_LANG[parent.messageLocale]}>
              {LOCALE_NAMES[parent.messageLocale]}
            </span>
          </Row>
          {parent.note ? (
            <div className="grid gap-0.5 sm:col-span-2">
              <dt className="text-muted-foreground">{p.note}</dt>
              <dd className="break-words whitespace-pre-line">{parent.note}</dd>
            </div>
          ) : null}
        </dl>
        <p className="text-sm text-muted-foreground">{p.remindersHint}</p>
      </section>

      <section aria-labelledby="children-title" className="flex flex-col gap-3">
        <h2 id="children-title" className="text-lg font-semibold">
          {p.children}
        </h2>
        {children.length === 0 ? (
          <EmptyState
            mood="hello"
            compact
            title={p.childrenEmptyTitle}
            description={p.childrenEmptyText}
          />
        ) : (
          <ul
            className="flex flex-col divide-y rounded-xl border bg-card"
            data-testid="parent-children"
          >
            {children.map((child) => (
              <ChildRow
                key={child.id}
                child={child}
                now={now}
                locale={locale}
                labels={{
                  status: messages.status[child.status],
                  pay: messages.payments.pay,
                  archived: p.childArchived,
                  noGroup: p.noGroup,
                  endsOn: p.endsOn,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </Texts>
  );
}

/** One child: name, status, group and end date (the block opens the card), and "Paid". */
function ChildRow({
  child,
  now,
  locale,
  labels,
}: {
  child: ParentChild;
  now: Date;
  locale: Locale;
  labels: {
    status: string;
    pay: string;
    archived: string;
    noGroup: string;
    endsOn: string;
  };
}) {
  const name = `${child.lastName} ${child.firstName}`;
  return (
    <li
      className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
      data-testid="parent-child"
    >
      <Link
        href={`/clients/${child.id}`}
        className="group flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <span className="font-medium break-words underline-offset-4 group-hover:underline">
          {name}
          {child.archived ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              ({labels.archived})
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <StatusBadge status={child.status} label={labels.status} />
          <span>{child.groupName ?? labels.noGroup}</span>
          {child.endsOn ? (
            <span>
              {labels.endsOn}:{" "}
              <DateText date={child.endsOn} today={now} locale={locale} />
            </span>
          ) : null}
        </span>
      </Link>
      {child.archived ? null : (
        <div className="grid shrink-0 grid-cols-1 md:w-[8.5rem]">
          <PayButton
            label={labels.pay}
            target={{
              clientId: child.id,
              name,
              endsOn: child.endsOn,
              price: child.price,
            }}
            today={now}
            record={recordPaymentAction}
            cancel={cancelPaymentAction}
          />
        </div>
      )}
    </li>
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
