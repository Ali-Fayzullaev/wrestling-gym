import { Construction } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import type { Actor } from "@/features/auth/roles";
import { ru } from "@/i18n/ru";

/** Body of a section that later steps fill in; shows who is signed in so access can be checked. */
export function PlaceholderPage({
  title,
  actor,
}: {
  title: string;
  actor: Actor;
}) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title={ru.pages.placeholder} />
      <p className="text-sm text-muted-foreground" data-testid="actor-role">
        {ru.roles[actor.role]}
      </p>
    </>
  );
}
