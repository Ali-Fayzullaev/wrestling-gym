"use client";

import { RotateCw } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { useText } from "@/i18n/client";

/**
 * Plain words and a retry button; the error itself stays in the server logs (no details, no PD).
 * A plain <button> with the default Button look: this boundary ships with every screen, and the
 * Button component would bring the class-merge engine (~9 KB) along.
 */
export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const errors = useText("errors");
  const common = useText("common");
  return (
    <EmptyState
      mood="oops"
      title={errors.pageTitle}
      description={errors.pageText}
      action={
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <RotateCw aria-hidden className="size-4" />
          {common.retry}
        </button>
      }
    />
  );
}
