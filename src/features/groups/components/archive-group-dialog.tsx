"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { groupsText } from "@/i18n/groups";
import { ru } from "@/i18n/ru";

import type { ActionResult } from "../result";
import type { ArchiveGroupInput } from "../schema";
import type { ArchiveOutcome } from "../service";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

const a = groupsText.archiveDialog;

/**
 * Asks before archiving. With clients in the group it says so and the button becomes "Archive
 * anyway"; only then is the archive forced. If clients appeared since the screen was drawn, the
 * server refuses the unforced archive and the dialog shows the new count.
 */
export default function ArchiveGroupDialog({
  groupId,
  members,
  open,
  onOpenChange,
  archive,
  returnTo,
}: {
  groupId: string;
  members: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archive: (input: ArchiveGroupInput) => Promise<ActionResult<ArchiveOutcome>>;
  /** The screen to show after archiving: the archived group's own screen is gone. */
  returnTo: string;
}) {
  const router = useRouter();
  const [clients, setClients] = useState(members);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await archive({ groupId, force: clients > 0 });
      if (!result.ok) {
        setError(groupsText.errors[result.error]);
        return;
      }
      if (!result.data.archived) {
        setClients(result.data.activeClients);
        setError(a.clientsAppeared);
        return;
      }
      toast.success(a.done);
      onOpenChange(false);
      router.replace(returnTo);
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
      title={a.title}
      description={a.text}
      footer={
        <>
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {ru.common.cancel}
          </button>
          <button
            type="button"
            className={buttonVariants({ variant: "destructive" })}
            onClick={confirm}
            disabled={pending}
          >
            {clients > 0 ? a.confirmAnyway : a.confirm}
          </button>
        </>
      }
    >
      {clients > 0 || error ? (
        <div className="grid gap-3 py-1 text-sm">
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-status-expired px-3 py-2 text-status-expired-foreground"
            >
              {error}
            </p>
          ) : null}
          {clients > 0 ? (
            <p className="rounded-md bg-status-expiring px-3 py-2 text-status-expiring-foreground">
              {a.withClients(clients)}
            </p>
          ) : null}
        </div>
      ) : null}
    </ResponsiveDialog>
  );
}
