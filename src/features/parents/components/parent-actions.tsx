"use client";

import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import type { ArchiveParentInput, DeleteParentInput } from "../schema";
import type { ParentError } from "../service";

const loadArchive = () => import("./archive-parent-dialog");
const loadDelete = () => import("./delete-parent-dialog");
const ArchiveParentDialog = lazy(loadArchive);
const DeleteParentDialog = lazy(loadDelete);

type Dialog = "archive" | "delete" | null;

/** What the parent's actions answer: ok, or why not, in codes the dialogs put into words. */
export type ParentActionReply =
  { ok: true } | { ok: false; error: ParentError };

/**
 * "To archive" / "Bring back" for staff and "Delete" for the owner on the parent's card; the
 * dialogs load on first intent. Hiding "Delete" is not the protection: the database checks the role.
 */
export function ParentActions({
  parentId,
  name,
  archived,
  canDelete,
  setArchived,
  remove,
}: {
  parentId: string;
  name: string;
  archived: boolean;
  canDelete: boolean;
  setArchived: (input: ArchiveParentInput) => Promise<ParentActionReply>;
  remove: (input: DeleteParentInput) => Promise<ParentActionReply>;
}) {
  const parentsText = useText("parents");
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
        data-testid="parent-archive"
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
        {archived ? parentsText.restore : parentsText.archive}
      </button>
      {canDelete ? (
        <button
          type="button"
          className={buttonVariants({ variant: "outline" })}
          onPointerEnter={() => void loadDelete()}
          onFocus={() => void loadDelete()}
          onClick={() => show("delete")}
          data-testid="parent-delete"
        >
          <Trash2 aria-hidden />
          {parentsText.delete}
        </button>
      ) : null}
      <Suspense fallback={null}>
        {requested.has("archive") ? (
          <ArchiveParentDialog
            parentId={parentId}
            archived={archived}
            open={open === "archive"}
            onOpenChange={onOpenChange("archive")}
            setArchived={setArchived}
          />
        ) : null}
        {requested.has("delete") ? (
          <DeleteParentDialog
            parentId={parentId}
            name={name}
            open={open === "delete"}
            onOpenChange={onOpenChange("delete")}
            remove={remove}
          />
        ) : null}
      </Suspense>
    </>
  );
}
