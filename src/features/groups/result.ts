import type { GroupField } from "./schema";
import type { GroupError } from "./service";

/** What a group Server Action returns to the screen: an error code, never internal details. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: GroupError; fields?: GroupField[] };
