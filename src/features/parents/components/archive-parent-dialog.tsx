"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import type { ArchiveParentInput } from "../schema";
import type { ParentActionReply } from "./parent-actions";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

/** Asks before archiving a parent or bringing one back; the card refreshes in place. */
export default function ArchiveParentDialog({
  parentId,
  archived,
  open,
  onOpenChange,
  setArchived,
}: {
  parentId: string;
  /** The parent's state now: true offers "Bring back". */
  archived: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setArchived: (input: ArchiveParentInput) => Promise<ParentActionReply>;
}) {
  const parentsText = useText("parents");
  const commonText = useText("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const texts = archived
    ? parentsText.restoreDialog
    : parentsText.archiveDialog;

  function confirm() {
    startTransition(async () => {
      const result = await setArchived({ parentId, archived: !archived });
      if (!result.ok) {
        setError(parentsText.errors[result.error]);
        return;
      }
      setError(null);
      toast.success(texts.done);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title={texts.title}
      description={texts.text}
      footer={
        <>
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {commonText.cancel}
          </button>
          <button
            type="button"
            className={buttonVariants({
              variant: archived ? "default" : "destructive",
            })}
            onClick={confirm}
            disabled={pending}
            data-testid="parent-archive-confirm"
          >
            {texts.confirm}
          </button>
        </>
      }
    >
      {error ? (
        <p
          role="alert"
          className="my-1 rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
        >
          {error}
        </p>
      ) : null}
    </ResponsiveDialog>
  );
}
