export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    </div>
  );
}
