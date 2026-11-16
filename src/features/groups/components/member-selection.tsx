"use client";

import { ArrowRightLeft } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";

import { buttonVariants } from "@/components/ui/variants";
import { useText } from "@/i18n/client";
import { fmt } from "@/i18n/format";

import type { ActionResult } from "../result";
import type { MoveClientsInput } from "../schema";
import type { MoveOutcome, MoveTarget } from "../service";

/** Name of the per-client checkbox the server-rendered rows carry. */
export const MEMBER_CHECKBOX = "client";

const loadMove = () => import("./move-clients-dialog");
const MoveClientsDialog = lazy(loadMove);

/**
 * Selection around the server-rendered client rows: it only counts the ticked checkboxes, so the
 * rows (names, status badges, dates) ship no JavaScript. "Move" opens the transfer dialog, which
 * loads on first intent.
 */
export function MemberSelection({
  children,
  total,
  targets,
  move,
}: {
  children: ReactNode;
  /** Number of rows, from the server, so it follows the list after a refresh. */
  total: number;
  targets: MoveTarget[];
  move: (input: MoveClientsInput) => Promise<ActionResult<MoveOutcome>>;
}) {
  const groupsText = useText("groups");
  const m = groupsText.moveDialog;
  const formRef = useRef<HTMLFormElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);

  const boxes = () =>
    Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement>(
        `input[name="${MEMBER_CHECKBOX}"]`,
      ) ?? [],
    );

  const recount = () =>
    setSelected(
      boxes()
        .filter((box) => box.checked)
        .map((box) => box.value),
    );

  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate =
        selected.length > 0 && selected.length < total;
  }, [selected.length, total]);

  const setAll = (checked: boolean) => {
    for (const box of boxes()) box.checked = checked;
    recount();
  };

  return (
    <form
      ref={formRef}
      onChange={recount}
      onSubmit={(event) => event.preventDefault()}
      className="flex flex-col gap-3"
    >
      <div className="flex min-h-11 items-center justify-between gap-3 px-1">
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={total > 0 && selected.length === total}
            onChange={(event) => setAll(event.target.checked)}
            className="size-5 accent-primary"
          />
          {m.selectAll}
        </label>
        <span
          className="text-sm text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {fmt(m.selected, { count: selected.length })}
        </span>
      </div>
      {children}
      {selected.length > 0 ? (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex justify-end md:bottom-4">
          <button
            type="button"
            className={`${buttonVariants({ size: "lg" })} w-full shadow-lg md:w-auto`}
            onPointerEnter={() => void loadMove()}
            onFocus={() => void loadMove()}
            onClick={() => {
              setRequested(true);
              setOpen(true);
            }}
          >
            <ArrowRightLeft aria-hidden />
            {`${groupsText.move} (${selected.length})`}
          </button>
        </div>
      ) : null}
      {requested ? (
        <Suspense fallback={null}>
          <MoveClientsDialog
            open={open}
            onOpenChange={setOpen}
            clientIds={selected}
            targets={targets}
            move={move}
            onMoved={() => setAll(false)}
          />
        </Suspense>
      ) : null}
    </form>
  );
}
