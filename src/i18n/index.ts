import { ru } from "./ru";

type Messages = typeof ru;

/** Dotted paths to plain strings ("nav.today"); texts with parameters stay functions on `ru`. */
type StringKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends (...args: never[]) => unknown
      ? never
      : StringKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = StringKeys<Messages>;

/** Interface text by key. Kazakh (D-04) will switch the dictionary here, not at call sites. */
export function t(key: MessageKey): string {
  let node: unknown = ru;
  for (const part of key.split(".")) {
    node =
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== "string") throw new Error(`Missing text: ${key}`);
  return node;
}

export { ru };
