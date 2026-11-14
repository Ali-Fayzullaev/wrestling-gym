/** The file and JSON fields of an import request. */
export function importForm(
  file: File,
  fields: Record<string, unknown>,
): FormData {
  const form = new FormData();
  form.set("file", file);
  for (const [name, value] of Object.entries(fields))
    form.set(name, JSON.stringify(value));
  return form;
}
