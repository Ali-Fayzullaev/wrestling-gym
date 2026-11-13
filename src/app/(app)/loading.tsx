export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-6 w-full max-w-md animate-pulse rounded-md bg-muted" />
    </div>
  );
}
