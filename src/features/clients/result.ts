import type { ClientField } from "./schema";
import type { ClientError } from "./service";

/** What a client Server Action returns to the screen: an error code, never internal details. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ClientError; fields?: ClientField[] };
