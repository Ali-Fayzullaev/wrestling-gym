"use client";

import { LogOut } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { ru } from "@/i18n/ru";
import { useHardNavigation } from "@/lib/use-hard-navigation";

import { type SignOutState, signOutAction } from "./actions";

const initialState: SignOutState = { redirectTo: null };

export function LogoutButton() {
  const [state, action, pending] = useActionState(signOutAction, initialState);
  useHardNavigation(state.redirectTo);

  return (
    <form action={action} className="ml-auto">
      <Button
        type="submit"
        variant="ghost"
        className="min-h-11"
        disabled={pending}
      >
        <LogOut aria-hidden />
        {ru.auth.logout}
      </Button>
    </form>
  );
}
