"use client";

import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { clientsText } from "@/i18n/clients";

import type { ActionResult } from "../result";
import type { ArchiveClientInput, DeleteClientInput } from "../schema";
import type { DeleteOutcome } from "../service";

const loadArchive = () => import("./archive-client-dialog");
const loadDelete = () => import("./delete-client-dialog");
const ArchiveClientDialog = lazy(loadArchive);
const DeleteClientDialog = lazy(loadDelete);

type Dialog = "archive" | "delete" | null;

/** "To archive" / "Bring back" for staff and "Delete" for the owner; dialogs load on first intent. */
export function ClientActions({
  clientId,
  lastName,
  archived,
  canDelete,
  setArchived,
  remove,
}: {
  clientId: string;
  lastName: string;
  archived: boolean;
  canDelete: boolean;
  setArchived: (
    input: ArchiveClientInput,
  ) => Promise<ActionResult<{ changed: boolean }>>;
  remove: (input: DeleteClientInput) => Promise<ActionResult<DeleteOutcome>>;
}) {
  const [requested, setRequested] = useState<ReadonlySet<Dialog>>(new Set());
  const [open, setOpen] = useState<Dialog>(null);

  const show = (dialog: Exclude<Dialog, null>) => {
    setRequested((current) => new Set(current).add(dialog));
    setOpen(dialog);
  };
  const onOpenChange = (dialog: Dialog) => (next: boolean) =>
    setOpen(next ? dialog : null);

  return (
    <>
      <button
        type="button"
        className={buttonVariants({ variant: "outline" })}
        onPointerEnter={() => void loadArchive()}
        onFocus={() => void loadArchive()}
        onClick={() => show("archive")}
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? clientsText.restore : clientsText.archive}
      </button>
      {canDelete ? (
        <button
          type="button"
          className={buttonVariants({ variant: "outline" })}
          onPointerEnter={() => void loadDelete()}
          onFocus={() => void loadDelete()}
          onClick={() => show("delete")}
        >
          <Trash2 aria-hidden />
          {clientsText.delete}
        </button>
      ) : null}
      <Suspense fallback={null}>
        {requested.has("archive") ? (
          <ArchiveClientDialog
            clientId={clientId}
            archived={archived}
            open={open === "archive"}
            onOpenChange={onOpenChange("archive")}
            setArchived={setArchived}
          />
        ) : null}
        {requested.has("delete") ? (
          <DeleteClientDialog
            clientId={clientId}
            lastName={lastName}
            open={open === "delete"}
            onOpenChange={onOpenChange("delete")}
            remove={remove}
          />
        ) : null}
      </Suspense>
    </>
  );
}
