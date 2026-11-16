import { inputClassName } from "@/components/ui/variants";

/** Labelled input with a hint that turns into the error message. */
export function TextField({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  hint: string;
  error: string | null;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  spellCheck?: boolean;
  autoCapitalize?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={`${inputClassName} max-w-md`}
        {...input}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {error ? (
          <span className="text-status-expired-foreground">{error}</span>
        ) : (
          hint
        )}
      </p>
    </div>
  );
}
