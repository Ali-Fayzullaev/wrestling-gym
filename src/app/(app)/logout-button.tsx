import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ru } from "@/i18n/ru";

/** A plain form posting to /auth/sign-out: works before scripts load and ships no JS. */
export function LogoutButton() {
  return (
    <form method="post" action="/auth/sign-out">
      <Button
        type="submit"
        variant="ghost"
        className="w-full justify-start text-muted-foreground hover:text-foreground"
      >
        <LogOut aria-hidden />
        {ru.auth.logout}
      </Button>
    </form>
  );
}
