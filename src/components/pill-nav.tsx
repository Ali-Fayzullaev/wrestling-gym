import Link from "next/link";

/**
 * Switch between lists or tabs of one screen, as links: the address keeps the choice and the
 * browser's back button works. The current one is marked with aria-current.
 */
export function PillNav<K extends string>({
  label,
  items,
  current,
}: {
  label: string;
  items: readonly { key: K; href: string; text: string }[];
  current: K;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          replace
          scroll={false}
          className="inline-flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
        >
          {item.text}
        </Link>
      ))}
    </nav>
  );
}
