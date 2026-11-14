"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { groupsText } from "@/i18n/groups";
import { ru } from "@/i18n/ru";

import { formatSeats, seatState } from "../format";
import type { ActionResult } from "../result";
import type { MoveClientsInput } from "../schema";
import type { MoveOutcome, MoveTarget } from "../service";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

const m = groupsText.moveDialog;

/** Pick the group to move the selected clients to. A full group warns but does not block. */
export default function MoveClientsDialog({
  open,
  onOpenChange,
  clientIds,
  targets,
  move,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientIds: string[];
  targets: MoveTarget[];
  move: (input: MoveClientsInput) => Promise<ActionResult<MoveOutcome>>;
  onMoved: () => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const legendId = useId();

  const target = targets.find((group) => group.id === targetId) ?? null;
  const after = target ? target.members + clientIds.length : 0;
  const over =
    target !== null && seatState(after, target.capacity) === "over"
      ? { members: after, capacity: target.capacity ?? 0 }
      : null;

  function confirm() {
    if (!target) return;
    startTransition(async () => {
      const result = await move({ clientIds, targetGroupId: target.id });
      if (!result.ok) {
        setError(groupsText.errors[result.error]);
        return;
      }
      toast.success(m.done(result.data.moved));
      setError(null);
      setTargetId(null);
      onMoved();
      onOpenChange(false);
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
      title={m.title}
      description={m.selected(clientIds.length)}
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
            className={buttonVariants()}
            onClick={confirm}
            disabled={pending || !target || clientIds.length === 0}
          >
            {m.confirm}
          </button>
        </>
      }
    >
      <div className="grid gap-3 py-1">
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
          >
            {error}
          </p>
        ) : null}
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noTargets}</p>
        ) : (
          <fieldset className="grid gap-2" aria-labelledby={legendId}>
            <p id={legendId} className="text-sm font-medium">
              {m.target}
            </p>
            <div className="flex max-h-[45dvh] flex-col divide-y overflow-y-auto rounded-xl border">
              {targets.map((group) => (
                <label
                  key={group.id}
                  className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 text-sm has-checked:bg-accent"
                >
                  <input
                    type="radio"
                    name="target-group"
                    value={group.id}
                    checked={targetId === group.id}
                    onChange={() => setTargetId(group.id)}
                    className="size-5 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {group.name}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatSeats(group.members, group.capacity)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {over ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md bg-status-expiring px-3 py-2 text-sm text-status-expiring-foreground"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {m.overWarning(over.members, over.capacity)}
          </p>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}
