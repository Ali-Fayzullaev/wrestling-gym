"use client";

import { KeyRound, ShieldCheck, ShieldOff, UserRound } from "lucide-react";
import { lazy, Suspense, useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/variants";
import type { StaffRole } from "@/features/auth/roles";
import { staffText } from "@/i18n/settings";

import type { StaffResult } from "../form-fields";

const t = staffText.list;

const loadDialog = () => import("./deactivate-staff-dialog");
const DeactivateStaffDialog = lazy(loadDialog);

export type UpdateStaffAccess = (input: {
  staffId: string;
  role: StaffRole;
  active: boolean;
}) => Promise<StaffResult>;

type Message = { tone: "ok" | "error"; text: string } | null;

/**
 * Role switch and (de)activation for one employee; deactivation asks first. The question loads
 * on first intent, so the dialog code is not part of the staff screen's first load.
 */
export function StaffAccessActions({
  staffId,
  fullName,
  role,
  active,
  update,
}: {
  staffId: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
  update: UpdateStaffAccess;
}) {
  const [message, setMessage] = useState<Message>(null);
  const [asked, setAsked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  async function apply(
    next: { role: StaffRole; active: boolean },
    done: string,
  ) {
    setMessage(null);
    try {
      const result = await update({ staffId, ...next });
      setMessage(
        result.ok
          ? { tone: "ok", text: done }
          : { tone: "error", text: staffText.errors[result.error] },
      );
    } catch {
      setMessage({ tone: "error", text: staffText.errors.unavailable });
    }
  }

  const otherRole: StaffRole = role === "owner" ? "admin" : "owner";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {active ? (
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                apply({ role: otherRole, active }, t.roleChanged),
              )
            }
          >
            {otherRole === "owner" ? (
              <ShieldCheck aria-hidden />
            ) : (
              <UserRound aria-hidden />
            )}
            {otherRole === "owner" ? t.makeOwner : t.makeAdmin}
          </button>
        ) : null}
        {active ? (
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            disabled={pending}
            onPointerEnter={() => void loadDialog()}
            onFocus={() => void loadDialog()}
            onClick={() => {
              setAsked(true);
              setConfirming(true);
            }}
          >
            <ShieldOff aria-hidden />
            {t.deactivate}
          </button>
        ) : (
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            disabled={pending}
            onClick={() =>
              startTransition(() => apply({ role, active: true }, t.activated))
            }
          >
            <KeyRound aria-hidden />
            {t.activate}
          </button>
        )}
      </div>
      {asked ? (
        <Suspense fallback={null}>
          <DeactivateStaffDialog
            fullName={fullName}
            open={confirming}
            pending={pending}
            onOpenChange={setConfirming}
            onConfirm={() =>
              startTransition(async () => {
                await apply({ role, active: false }, t.deactivated);
                setConfirming(false);
              })
            }
          />
        </Suspense>
      ) : null}
      <p
        role={message?.tone === "error" ? "alert" : "status"}
        className={`text-sm ${message?.tone === "ok" ? "text-status-active-foreground" : "text-status-expired-foreground"}`}
      >
        {message?.text}
      </p>
    </div>
  );
}
