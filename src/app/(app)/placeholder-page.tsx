import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import type { Actor } from "@/features/auth/roles";
import { getI18n } from "@/i18n/server";

/** Body of a section that later steps fill in; shows who is signed in so access can be checked. */
export async function PlaceholderPage({
  title,
  actor,
}: {
  title: string;
  actor: Actor;
}) {
  const { t } = await getI18n();
  return (
    <>
      <PageHeader title={title} />
      <EmptyState mood="focus" title={t.pages.placeholder} />
      <p className="text-sm text-muted-foreground" data-testid="actor-role">
        {t.roles[actor.role]}
      </p>
    </>
  );
}
