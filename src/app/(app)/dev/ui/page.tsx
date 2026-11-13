import { Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type * as React from "react";

import { DateText } from "@/components/date-text";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/list-skeleton";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  StatusBadge,
  type SubscriptionStatus,
} from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { devUi } from "@/i18n/dev-ui";
import { ru } from "@/i18n/ru";

import { FormDemo, OverlaysDemo, TabsDemo } from "./demos";

export const metadata: Metadata = {
  title: `${devUi.title} | ${ru.app.name}`,
};

const STATUSES: SubscriptionStatus[] = [
  "active",
  "expiring",
  "expired",
  "none",
];

/**
 * Off in production. `next dev` turns it on; the e2e server sets ENABLE_DEV_UI=1 so the tests can
 * check the components in a production build. No data, and still behind sign-in.
 */
function devUiEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" || process.env.ENABLE_DEV_UI === "1"
  );
}

export default async function DevUiPage() {
  // Read the flag per request, not at build time.
  await connection();
  if (!devUiEnabled()) notFound();
  const now = new Date();
  const d = devUi;

  return (
    <>
      {/* Mounted per screen that shows toasts: sonner is too heavy for every route's first load. */}
      <Toaster
        position="bottom-center"
        mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      />
      <PageHeader
        title={d.title}
        description={d.description}
        actions={<Button>{d.primary}</Button>}
      />

      <Section title={d.buttons}>
        <div className="flex flex-wrap gap-2">
          <Button>{d.primary}</Button>
          <Button variant="secondary">{d.secondary}</Button>
          <Button variant="outline">{d.outline}</Button>
          <Button variant="destructive">{d.destructive}</Button>
          <Button variant="ghost">{d.ghost}</Button>
          <Button variant="link">{d.ghost}</Button>
          <Button disabled>{d.disabled}</Button>
          <Button size="sm" variant="outline">
            {d.outline}
          </Button>
          <Button size="lg">{d.primary}</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{d.primary}</Badge>
          <Badge variant="secondary">{d.secondary}</Badge>
          <Badge variant="outline">{d.outline}</Badge>
          <Badge variant="destructive">{d.destructive}</Badge>
        </div>
      </Section>

      <Section title={d.statuses}>
        <div className="flex flex-wrap gap-2" data-testid="status-badges">
          {STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title={d.numbers}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">25000</dt>
          <dd>
            <Money amount={25000} />
          </dd>
          <dt className="text-muted-foreground">-25000</dt>
          <dd>
            <Money amount={-25000} />
          </dd>
          <dt className="text-muted-foreground">0</dt>
          <dd>
            <Money amount={0} />
          </dd>
          <dt className="text-muted-foreground">+5</dt>
          <dd>
            <DateText date={new Date(now.getTime() + 5 * 864e5)} today={now} />
          </dd>
          <dt className="text-muted-foreground">-400</dt>
          <dd>
            <DateText
              date={new Date(now.getTime() - 400 * 864e5)}
              today={now}
            />
          </dd>
        </dl>
      </Section>

      <Section title={d.counters}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={d.counterDebts} value={7} href="/clients" emphasis />
          <StatCard label={d.counterExpiring} value={12} href="/clients" />
          <StatCard label={d.counterZero} value={0} href="/today" emphasis />
        </div>
      </Section>

      <Section title={d.form}>
        <FormDemo />
      </Section>

      <Section title={d.overlays}>
        <OverlaysDemo />
      </Section>

      <Section title={d.tabs}>
        <TabsDemo />
      </Section>

      <Section title={d.table}>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{d.tableClient}</TableHead>
                <TableHead>{d.tableStatus}</TableHead>
                <TableHead className="text-right">{d.tableAmount}</TableHead>
                <TableHead>{d.tableUntil}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{d.sampleClientA}</TableCell>
                <TableCell>
                  <StatusBadge status="active" />
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={25000} />
                </TableCell>
                <TableCell>
                  <DateText
                    date={new Date(now.getTime() + 20 * 864e5)}
                    today={now}
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{d.sampleClientB}</TableCell>
                <TableCell>
                  <StatusBadge status="expired" />
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={18000} />
                </TableCell>
                <TableCell>
                  <DateText
                    date={new Date(now.getTime() - 3 * 864e5)}
                    today={now}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title={d.empty}>
        <EmptyState
          icon={Users}
          title={d.emptyTitle}
          description={d.emptyText}
          action={<Button>{d.emptyAction}</Button>}
        />
      </Section>

      <Section title={d.loading}>
        <ListSkeleton rows={3} />
      </Section>

      <Section title={d.glyphs}>
        <p className="text-2xl" data-testid="kazakh-glyphs">
          {d.glyphsSample}
        </p>
      </Section>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
