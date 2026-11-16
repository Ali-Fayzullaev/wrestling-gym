"use client";

import { Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";

import type { ActionResult } from "../result";
import type { Coach } from "../service";

const loadForm = () => import("./group-form-dialog");
const GroupFormDialog = lazy(loadForm);

/**
 * The owner's "New group" button. The form (dialog, fields, toasts) loads on first intent, so it
 * is not part of the list's first load.
 */
export function CreateGroupButton({
  coaches,
  create,
}: {
  coaches: Coach[];
  create: (form: FormData) => Promise<ActionResult<{ id: string }>>;
}) {
  const groupsText = useText("groups");
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonVariants()}
        onPointerEnter={() => void loadForm()}
        onFocus={() => void loadForm()}
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
      >
        <Plus aria-hidden />
        {groupsText.create}
      </button>
      {requested ? (
        <Suspense fallback={null}>
          <GroupFormDialog
            mode="create"
            open={open}
            onOpenChange={setOpen}
            coaches={coaches}
            submit={create}
          />
        </Suspense>
      ) : null}
    </>
  );
}
