"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { useText } from "@/i18n/client";
import { normalizePhone } from "@/lib/phone";

import type { ActionResult } from "../result";
import type { PhoneCheckInput } from "../schema";
import type { PhoneDuplicate } from "../service";

export type CheckPhone = (
  input: PhoneCheckInput,
) => Promise<ActionResult<PhoneDuplicate[]>>;

/**
 * Leaving a phone field checks the number and looks up other clients with it: a warning, saving is
 * still allowed. Each phone field of the form has its own.
 */
export function usePhoneCheck(
  checkPhone: CheckPhone,
  excludeId: string | null,
  /** The number on file when editing: not looked up again. */
  initialPhone: string | null,
) {
  const [wrong, setWrong] = useState(false);
  const [duplicates, setDuplicates] = useState<PhoneDuplicate[]>([]);
  // The last number looked up, so leaving the field again does not ask twice.
  const checked = useRef<string | null>(
    initialPhone === null ? null : normalizePhone(initialPhone),
  );

  function onBlur(value: string) {
    if (value.trim() === "") {
      setWrong(false);
      return;
    }
    const phone = normalizePhone(value);
    setWrong(phone === null);
    if (phone === null || phone === checked.current) return;
    checked.current = phone;
    void checkPhone({ phone, excludeId }).then((result) => {
      // A newer number may have been typed meanwhile.
      if (checked.current === phone && result.ok) setDuplicates(result.data);
    });
  }

  return { wrong, duplicates, onBlur, onChange: () => setWrong(false) };
}

export function PhoneDuplicates({
  duplicates,
}: {
  duplicates: PhoneDuplicate[];
}) {
  const f = useText("clientForm");
  if (duplicates.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="phone-duplicates"
      className="-mt-2 grid gap-1 rounded-md bg-status-expiring px-3 py-2 text-sm text-status-expiring-foreground"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        {f.duplicates}
      </p>
      <ul className="grid gap-0.5 pl-6">
        {duplicates.map((duplicate) => (
          <li key={duplicate.id}>
            <Link
              href={`/clients/${duplicate.id}`}
              prefetch={false}
              target="_blank"
              className="underline underline-offset-4"
            >
              {duplicate.lastName} {duplicate.firstName}
            </Link>
            {duplicate.archived ? ` (${f.duplicateArchived})` : null}
          </li>
        ))}
      </ul>
      <p>{f.duplicatesHint}</p>
    </div>
  );
}
