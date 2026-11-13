export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div className="h-9 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-7 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-11 w-48 animate-pulse rounded-md bg-muted" />
    </main>
  );
}
