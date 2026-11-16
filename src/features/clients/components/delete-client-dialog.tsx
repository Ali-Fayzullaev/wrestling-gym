"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { requestToaster } from "@/components/deferred-toaster";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants, inputClassName } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import {
  DELETE_REASONS,
  type DeleteReason,
  lastNameConfirmed,
} from "../form-fields";
import type { ActionResult } from "../result";
import type { DeleteClientInput } from "../schema";
import type { DeleteOutcome } from "../service";

// This dialog confirms with a toast: make sure the toast area is there.
requestToaster();

/**
 * Full deletion (owner only; the server checks the role, the reason and the typed last name
 * again). The button stays off until a reason is chosen and the last name is typed.
 */
export default function DeleteClientDialog({
  clientId,
  lastName,
  open,
  onOpenChange,
  remove,
}: {
  clientId: string;
  lastName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remove: (input: DeleteClientInput) => Promise<ActionResult<DeleteOutcome>>;
}) {
  const clientsText = useText("clients");
  const d = clientsText.deleteDialog;
  const commonText = useText("common");
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState<DeleteReason | "">("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = reason !== "" && lastNameConfirmed(typed, lastName);

  function confirm() {
    if (reason === "") return;
    startTransition(async () => {
      const result = await remove({ clientId, reason, lastName: typed });
      if (!result.ok) {
        setError(clientsText.errors[result.error]);
        return;
      }
      toast.success(
        result.data.mode === "anonymized" ? d.anonymized : d.deleted,
      );
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
            {fmt(d.confirmLabel, { lastName })}
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
