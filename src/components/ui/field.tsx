import type * as React from "react";

type FieldProps = Omit<React.ComponentProps<"input">, "id"> & {
  id: string;
  label: string;
};

/** Labelled text input with a 44px touch target. Design tokens arrive in step 04. */
function Field({ id, label, className, ...props }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className={`min-h-11 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive ${className ?? ""}`}
        {...props}
      />
    </div>
  );
}

/** Form-level error or notice, announced by screen readers when it appears. */
function FormMessage({
  id,
  tone,
  children,
}: {
  id: string;
  tone: "error" | "info";
  children: React.ReactNode;
}) {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "text-sm text-destructive"
          : "text-sm text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}

export { Field, FormMessage };
