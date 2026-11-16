"use client";

import { useState } from "react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { useText } from "@/i18n/client";

import { ResponsiveDialog } from "./responsive-dialog";

/**
 * Asks before an irreversible action only (reversal, archive, deletion); reversible actions get a
 * toast with "Undo" instead. The confirm button names the action, never just "OK".
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
}: {
  trigger: React.ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
}) {
  const common = useText("common");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
      trigger={trigger}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {common.cancel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={confirm}
            disabled={pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
