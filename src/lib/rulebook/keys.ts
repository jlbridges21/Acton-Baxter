/**
 * Key generation and slugification for rulebook entities.
 */

/**
 * Slugify a display name into a valid key.
 * Example: "Partnership Evaluation Meeting" -> "partnership_evaluation_meeting"
 */
export function slugifyKey(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_\s]/g, "") // Remove special chars except underscore and space
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, ""); // Trim leading/trailing underscores
}

/**
 * Ensure key uniqueness by appending _2, _3, etc. if the key already exists.
 */
export function ensureUniqueKey(baseKey: string, existingKeys: Set<string>): string {
  if (!existingKeys.has(baseKey)) {
    return baseKey;
  }

  let counter = 2;
  while (existingKeys.has(`${baseKey}_${counter}`)) {
    counter++;
  }

  return `${baseKey}_${counter}`;
}
