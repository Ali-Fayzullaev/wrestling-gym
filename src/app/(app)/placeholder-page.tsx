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
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{ru.pages.placeholder}</p>
      <p className="text-sm text-muted-foreground" data-testid="actor-role">
        {ru.roles[actor.role]}
      </p>
    </>
  );
}
