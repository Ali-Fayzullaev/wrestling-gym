import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getI18n } from "@/i18n/server";

/** A plain form posting to /auth/sign-out: works before scripts load and ships no JS. */
export async function LogoutButton() {
  const { t } = await getI18n();
  return (
    <form method="post" action="/auth/sign-out">
      <Button
        type="submit"
        variant="ghost"
        className="w-full justify-start text-muted-foreground hover:text-foreground"
      >
        <LogOut aria-hidden />
        {t.auth.logout}
      </Button>
    </form>
  );
}
