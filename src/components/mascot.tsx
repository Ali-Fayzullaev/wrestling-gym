import { mascotSrc, type MascotMood } from "@/lib/mascot";

/**
 * The gym's mascot as a plain image: no JavaScript, cached across pages, decorative (alt="" and
 * hidden from screen readers; the text next to it carries the meaning). Width and height are set,
 * so the page does not shift while it loads. No class-merge helper: the error boundary is a client
 * component, and this must not pull that engine into every screen's JavaScript.
 */
export function Mascot({
  mood,
  size,
  priority = false,
  className,
  src = mascotSrc(mood),
}: {
  mood: MascotMood;
  size: number;
  /** Above the fold on a page where it may be the largest element (login). */
  priority?: boolean;
  className?: string;
  /** Another address of the same picture; FirstScreenMascot passes the inline copy. */
  src?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 4 KB SVG: next/image adds nothing but JS.
    <img
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      data-mascot={mood}
      className={`shrink-0 select-none ${className ?? ""}`}
    />
  );
}
