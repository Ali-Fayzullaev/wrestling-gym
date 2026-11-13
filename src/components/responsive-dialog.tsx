"use client";

import type * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useMediaQuery } from "@/lib/use-media-query";

/** Tailwind `md`: the width where the side menu replaces the bottom one. */
const DESKTOP_QUERY = "(min-width: 48rem)";

type ResponsiveDialogProps = {
  title: string;
  description?: string;
  /** Element that opens the dialog; rendered as is (asChild). */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  /** Buttons; stacked full-width on a phone, in a row on a computer. */
  footer?: React.ReactNode;
};

/** A form or question: a sheet from the bottom on a phone (thumb reach), a dialog on a computer. */
export function ResponsiveDialog({
  title,
  description,
  trigger,
  open,
  onOpenChange,
  children,
  footer,
}: ResponsiveDialogProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY);

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {children}
          {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="pr-14">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        {children ? <div className="px-4 pb-2">{children}</div> : null}
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
