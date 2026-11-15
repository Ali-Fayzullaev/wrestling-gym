import { Money } from "@/components/money";

export type Bar = { key: string; label: string; amount: number; count: number };

/**
 * Amounts as horizontal bars drawn with CSS (no chart library: the screen ships no extra JS).
 * The longest bar is the biggest amount; each row also says the amount and count in text, so the
 * bar is never the only way to read it.
 */
export function BarList({
  title,
  hint,
  bars,
  countLabel,
  testId,
}: {
  title: string;
  hint?: string;
  bars: readonly Bar[];
  countLabel: (count: number) => string;
  testId: string;
}) {
  const max = Math.max(0, ...bars.map((bar) => bar.amount));
  const headingId = `${testId}-title`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid={testId}
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <ul className="flex flex-col gap-3">
        {bars.map((bar) => (
          <li
            key={bar.key}
            className="flex flex-col gap-1.5"
            data-testid="bar-row"
          >
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{bar.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-muted-foreground tabular-nums">
                  {countLabel(bar.count)}
                </span>
                <Money amount={bar.amount} className="font-semibold" />
              </span>
            </div>
            <div
              aria-hidden
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${max > 0 ? Math.max(0, (bar.amount / max) * 100) : 0}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
