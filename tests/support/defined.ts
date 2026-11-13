/** Narrows a value a test has just set up; fails loudly instead of a silent non-null assertion. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined)
    throw new Error(`expected ${what} to be set`);
  return value;
}
