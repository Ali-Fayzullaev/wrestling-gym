"use client";

import {
  KeyRound,
  RotateCcwKey,
  ShieldCheck,
  ShieldOff,
  UserRound,
} from "lucide-react";
import { lazy, Suspense, useState, useTransition } from "react";

import { buttonVariants } from "@/components/ui/variants";
import type { StaffRole } from "@/features/auth/roles";
import { useText } from "@/i18n/client";

import type { StaffResult } from "../form-fields";

const loadDialog = () => import("./deactivate-staff-dialog");
const DeactivateStaffDialog = lazy(loadDialog);
const loadResetDialog = () => import("./reset-password-dialog");
const ResetPasswordDialog = lazy(loadResetDialog);

export type UpdateStaffAccess = (input: {
  staffId: string;
  role: StaffRole;
  active: boolean;
}) => Promise<StaffResult>;

export type ResetStaffPassword = (input: {
  staffId: string;
  password: string;
}) => Promise<StaffResult>;

type Message = { tone: "ok" | "error"; text: string } | null;

/**
 * Role switch, (de)activation and a new temporary password for one employee; deactivation and the
 * password ask first. The dialogs load on first intent, so their code is not part of the staff
 * screen's first load.
 */
export function StaffAccessActions({
  staffId,
  fullName,
  role,
  active,
  update,
  resetPassword,
}: {
  staffId: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
  update: UpdateStaffAccess;
  resetPassword: ResetStaffPassword;
}) {
  const staffText = useText("staff");
  const t = staffText.list;
  const [message, setMessage] = useState<Message>(null);
  const [asked, setAsked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetAsked, setResetAsked] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetInvalid, setResetInvalid] = useState<string | null>(null);
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

  async function submitReset(password: string): Promise<boolean> {
    setMessage(null);
    setResetInvalid(null);
    try {
      const result = await resetPassword({ staffId, password });
      if (result.ok) {
        setResetting(false);
        setMessage({ tone: "ok", text: staffText.reset.done });
        return true;
      }
      if (result.error === "invalid" || result.error === "weak_password") {
        setResetInvalid(
          result.error === "weak_password"
            ? staffText.errors.weak_password
            : staffText.add.errors.password,
        );
        return false;
      }
      setResetting(false);
      setMessage({ tone: "error", text: staffText.errors[result.error] });
    } catch {
      setResetting(false);
      setMessage({ tone: "error", text: staffText.errors.unavailable });
    }
    return false;
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
            onPointerEnter={() => void loadResetDialog()}
            onFocus={() => void loadResetDialog()}
            onClick={() => {
              setResetInvalid(null);
              setResetAsked(true);
              setResetting(true);
            }}
          >
            <RotateCcwKey aria-hidden />
            {t.resetPassword}
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
      {resetAsked ? (
        <Suspense fallback={null}>
          <ResetPasswordDialog
            fullName={fullName}
            open={resetting}
            pending={pending}
            invalid={resetInvalid}
            onOpenChange={setResetting}
            onSubmit={(password) =>
              new Promise<boolean>((resolve) => {
                startTransition(async () => {
                  resolve(await submitReset(password));
                });
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
