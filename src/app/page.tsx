import { Button } from "@/components/ui/button";
import { ru } from "@/i18n/ru";

// Temporary placeholder until the real screens arrive (steps 03-08).
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{ru.home.title}</h1>
      <p className="text-lg text-muted-foreground">{ru.home.subtitle}</p>
      <Button size="lg" className="min-h-11 self-start" disabled>
        {ru.home.loginSoon}
      </Button>
    </main>
  );
}
