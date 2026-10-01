import { customAlphabet } from "nanoid";

const slug = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

/** Unique-index collisions are rare. Retry rather than failing the create. */
export const TOUR_SLUG_INSERT_ATTEMPTS = 4;

export function createTourSlug(): string {
  return slug();
}

export type SlugInsertResult<T> =
  { ok: true; value: T } | { ok: false; code: string | null; message: string };

export async function insertWithUniqueSlug<T>(
  insert: (slug: string) => Promise<SlugInsertResult<T>>,
): Promise<{ value: T | null; error: string | null }> {
  for (let attempt = 0; attempt < TOUR_SLUG_INSERT_ATTEMPTS; attempt += 1) {
    const result = await insert(createTourSlug());
    if (result.ok) return { value: result.value, error: null };
    if (result.code !== "23505") {
      return { value: null, error: result.message || "Could not create the tour." };
    }
  }
  return { value: null, error: "Could not create a unique tour link. Try again." };
}
