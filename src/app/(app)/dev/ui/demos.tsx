"use client";

import { Ellipsis } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { devUi } from "@/i18n/dev-ui";

const d = devUi;

export function FormDemo() {
  return (
    <div className="grid max-w-md gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="demo-phone">{d.phone}</Label>
        <Input
          id="demo-phone"
          type="tel"
          inputMode="tel"
          defaultValue="+7 701"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="demo-phone-invalid">{d.phone}</Label>
        <Input
          id="demo-phone-invalid"
          type="tel"
          inputMode="tel"
          defaultValue="8701"
          aria-invalid
          aria-describedby="demo-phone-error"
        />
        <p id="demo-phone-error" className="text-sm text-destructive">
          {d.phoneError}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="demo-amount">{d.amount}</Label>
        <Input
          id="demo-amount"
          inputMode="numeric"
          defaultValue="25000"
          className="tabular-nums"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="demo-group">{d.group}</Label>
        <Select>
          <SelectTrigger id="demo-group" className="w-full">
            <SelectValue placeholder={d.groupPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">{d.groupA}</SelectItem>
            <SelectItem value="b">{d.groupB}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Label className="flex min-h-11 items-center gap-3">
        <Checkbox defaultChecked />
        {d.checkbox}
      </Label>
      <div className="grid gap-1.5">
        <Label htmlFor="demo-disabled">{d.disabledField}</Label>
        <Input id="demo-disabled" disabled defaultValue="admin" />
      </div>
    </div>
  );
}

export function OverlaysDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <ResponsiveDialog
        trigger={<Button>{d.openDialog}</Button>}
        title={d.dialogTitle}
        description={d.dialogText}
        footer={<Button>{d.save}</Button>}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="demo-dialog-phone">{d.phone}</Label>
          <Input id="demo-dialog-phone" type="tel" inputMode="tel" />
        </div>
      </ResponsiveDialog>
      <ConfirmDialog
        trigger={<Button variant="outline">{d.confirm}</Button>}
        title={d.confirmTitle}
        description={d.confirmText}
        confirmLabel={d.confirmAction}
        destructive
        onConfirm={() => undefined}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={d.menu}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem>{d.menuEdit}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">
            {d.menuArchive}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="secondary" onClick={() => toast.success(d.toastText)}>
        {d.toast}
      </Button>
    </div>
  );
}

export function TabsDemo() {
  return (
    <Tabs defaultValue="all" className="max-w-md">
      <TabsList>
        <TabsTrigger value="all">{d.tabAll}</TabsTrigger>
        <TabsTrigger value="debts">{d.tabDebts}</TabsTrigger>
      </TabsList>
      <TabsContent value="all" className="text-sm">
        {d.tabsAllText}
      </TabsContent>
      <TabsContent value="debts" className="text-sm">
        {d.tabsDebtsText}
      </TabsContent>
    </Tabs>
  );
}
