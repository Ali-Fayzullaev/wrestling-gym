"use client";

import { Archive, Pencil } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import type { ActionResult } from "../result";
import type { ArchiveGroupInput } from "../schema";
import type { ArchiveOutcome, Coach } from "../service";
import type { GroupFormValues } from "./group-form-dialog";

const loadForm = () => import("./group-form-dialog");
const loadArchive = () => import("./archive-group-dialog");
const GroupFormDialog = lazy(loadForm);
const ArchiveGroupDialog = lazy(loadArchive);

type Dialog = "edit" | "archive" | null;

/** "Edit" and "To archive" for the owner; each dialog loads on first intent. */
export function GroupOwnerActions({
  groupId,
  values,
  members,
  coaches,
  update,
  archive,
  returnTo = "/groups",
}: {
  groupId: string;
  values: GroupFormValues;
  members: number;
  coaches: Coach[];
  update: (form: FormData) => Promise<ActionResult<null>>;
  archive: (input: ArchiveGroupInput) => Promise<ActionResult<ArchiveOutcome>>;
  /** Where archiving leads: the group list from a group screen, Settings from Settings. */
  returnTo?: string;
}) {
  const groupsText = useText("groups");
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
        onPointerEnter={() => void loadForm()}
        onFocus={() => void loadForm()}
        onClick={() => show("edit")}
      >
        <Pencil aria-hidden />
        {groupsText.edit}
      </button>
      <button
        type="button"
        className={buttonVariants({ variant: "outline" })}
        onPointerEnter={() => void loadArchive()}
        onFocus={() => void loadArchive()}
        onClick={() => show("archive")}
      >
        <Archive aria-hidden />
        {groupsText.archive}
      </button>
      <Suspense fallback={null}>
        {requested.has("edit") ? (
          <GroupFormDialog
            mode="edit"
            open={open === "edit"}
            onOpenChange={onOpenChange("edit")}
            coaches={coaches}
            submit={update}
            initial={values}
          />
        ) : null}
        {requested.has("archive") ? (
          <ArchiveGroupDialog
            groupId={groupId}
            members={members}
            open={open === "archive"}
            onOpenChange={onOpenChange("archive")}
            archive={archive}
            returnTo={returnTo}
          />
        ) : null}
      </Suspense>
    </>
  );
}
