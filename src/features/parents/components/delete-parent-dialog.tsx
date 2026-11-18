"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import {
  DELETE_REASONS,
  type DeleteReason,
  lastNameConfirmed,
} from "@/features/clients/form-fields";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import type { DeleteParentInput } from "../schema";
import type { ParentActionReply } from "./parent-actions";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

/**
 * Deletes a parent created by mistake (owner only; the server checks the role, the reason, the
 * typed name and that no child is left). The button stays off until a reason is chosen and the
 * name is typed.
 */
export default function DeleteParentDialog({
  parentId,
  name,
  open,
  onOpenChange,
  remove,
}: {
  parentId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remove: (input: DeleteParentInput) => Promise<ParentActionReply>;
}) {
  const parentsText = useText("parents");
  const d = parentsText.deleteDialog;
  const commonText = useText("common");
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState<DeleteReason | "">("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Compared like delete_parent() does: case and surrounding spaces do not matter.
  const ready = reason !== "" && lastNameConfirmed(typed, name);

  function confirm() {
    if (reason === "") return;
    startTransition(async () => {
      const result = await remove({ parentId, reason, name: typed });
      if (!result.ok) {
        setError(parentsText.errors[result.error]);
        return;
      }
      toast.success(d.deleted);
      onOpenChange(false);
      router.replace("/clients");
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
      title={d.title}
      description={d.text}
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
            className={buttonVariants({ variant: "destructive" })}
            onClick={confirm}
            disabled={!ready || pending}
            data-testid="parent-delete-confirm"
          >
            {pending ? d.deleting : d.confirm}
          </button>
        </>
      }
    >
      <div className="grid gap-4 py-1">
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-status-expired px-3 py-2 text-sm text-status-expired-foreground"
          >
            {error}
          </p>
        ) : null}
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-reason`} className="text-sm font-medium">
            {d.reason}
          </label>
          <select
            id={`${id}-reason`}
            value={reason}
            onChange={(event) =>
              setReason(
                DELETE_REASONS.find((r) => r === event.target.value) ?? "",
              )
            }
            className={inputClassName}
          >
            <option value="" disabled>
              {d.reasonPlaceholder}
            </option>
            {DELETE_REASONS.map((value) => (
              <option key={value} value={value}>
                {d.reasons[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-confirm`} className="text-sm font-medium">
            {fmt(d.confirmLabel, { name })}
          </label>
          <input
            id={`${id}-confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={inputClassName}
          />
        </div>
      </div>
    </ResponsiveDialog>
  );
}
