"use client";

import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { ru } from "@/i18n/ru";
import { staffText } from "@/i18n/settings";

const t = staffText.list;

/** Asks before cutting an employee off; loaded on first intent, not with the staff screen. */
export default function DeactivateStaffDialog({
  fullName,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  fullName: string;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={t.deactivateTitle(fullName)}
      description={t.deactivateText}
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
            onClick={onConfirm}
            disabled={pending}
          >
            {t.deactivate}
          </button>
        </>
      }
    />
  );
}
