/** Lightweight text matching shared by the delegation router and knowledge search. */

const STOPWORDS = new Set(
  "a an the and or but if of to in on for with at by from as is are was were be been being do does did can could should would will shall may might must i me my we our us you your he she it they them this that these those what which who whom how when where why please baxter hey hi help".split(
    " ",
  ),
);

export function normalize(textIn: string): string {
  return textIn
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word: string): string {
  return word.replace(/(ings|ing|ers|er|ed|es|s)$/u, "").replace(/-/g, "");
}

export function contentTokens(textIn: string): Set<string> {
  return new Set(
    normalize(textIn)
      .split(" ")
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map(stem)
      .filter(Boolean),
  );
}

/** Cosine similarity over content-word sets (0..1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.sqrt(a.size * b.size);
}
