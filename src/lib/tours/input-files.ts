/**
 * Copy the selected files before clearing the input.
 * A file input's FileList is live: setting `value` to "" empties it, and
 * reading the list after that returns nothing and no error.
 */
export function takeInputFiles(list: FileList | null): File[] {
  return Array.from(list ?? []);
}
