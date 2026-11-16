"use client";

import { ResponsiveDialog } from "@/components/responsive-dialog";
import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

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
  const staffText = useText("staff");
  const t = staffText.list;
  const commonText = useText("common");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={fmt(t.deactivateTitle, { name: fullName })}
      description={t.deactivateText}
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
