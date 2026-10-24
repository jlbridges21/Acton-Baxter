/**
 * Output safety for Global Search: plain-text snippets and validated navigation targets.
 * Every result passes through these in the engine, whatever the provider returned.
 */

import { FLOOR_PLAN_LIBRARY_URL } from "@/lib/baxter/tools";

/** External hosts a result may link to. Anything else is dropped (never guessed). */
export const ALLOWED_EXTERNAL_HOSTS = new Set([
  "app.jobtread.com",
  new URL(FLOOR_PLAN_LIBRARY_URL).hostname,
]);

/** Plain text only: no tags, control characters, or runs of whitespace; length-capped. */
export function safeText(value: unknown, max = 160): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[*_`#>]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export type ValidatedUrl = { url: string; external: boolean };

/**
 * Same-origin paths ("/reports/…") or https URLs on an allow-listed host. Rejects
 * protocol-relative URLs, backslashes, `javascript:` and other schemes, and credentials.
 */
export function validateResultUrl(raw: string | null | undefined): ValidatedUrl | null {
  if (!raw || typeof raw !== "string" || raw.length > 600) return null;
  if (/[\s\\]/.test(raw) || /[\u0000-\u001f]/.test(raw)) return null;
  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) return null;
    try {
      const u = new URL(raw, "https://baxter.invalid");
      if (u.origin !== "https://baxter.invalid") return null;
      return { url: `${u.pathname}${u.search}${u.hash}`, external: false };
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) return null;
    return { url: u.toString(), external: true };
  } catch {
    return null;
  }
}

/** Only ids made of safe characters are ever interpolated into a link. */
export function safeId(value: unknown, pattern = /^[A-Za-z0-9_-]{1,64}$/): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/**
 * A short plain-text excerpt of `text` around the first query word it contains (for body
 * matches whose summary doesn't show why the record matched). Null when no word appears.
 */
export function snippetAround(text: unknown, query: string, max = 160): string | null {
  const plain = safeText(text, 20_000);
  if (!plain) return null;
  const lower = plain.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const at = words.map((w) => lower.indexOf(w)).find((i) => i >= 0);
  if (at === undefined) return null;
  const start = Math.max(0, at - Math.floor(max / 3));
  const slice = plain.slice(start, start + max).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + max < plain.length ? "…" : ""}`;
}
