import { Skeleton } from "@/components/ui/skeleton";

/** Label-and-field pairs with the form's rhythm, so the form replaces it without a jump. */
export function FormSkeleton() {
  return (
    <div aria-hidden className="grid max-w-2xl gap-5">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid gap-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-11 rounded-md" />
        </div>
      ))}
    </div>
  );
}
