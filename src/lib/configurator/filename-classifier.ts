/**
 * Suggests what an uploaded rendering shows from its file name, so admins can drop a batch
 * of files and confirm instead of mapping each one by hand. Suggestions are always shown for
 * review; nothing is assigned without the admin confirming.
 *
 * Recognizes Acton's naming, e.g.
 *   "03-Investor Series i-448-A-2 (BD-1) (BA-1) Berkeley Modern - 9-1.jpg"   → exterior, 9 ft
 *   "05-Signature Series S-748-B-1 (P) Half Moon Bay Coastal.jpg"           → exterior, porch
 *   "… California Coastal - Lighting Dusk Uplights - 9-1.jpg"                → interior, 9 ft
 *   "Investor Series - Plan i-448-A-1 (BD-1) (BA-1) (REV)_3k.jpg"           → mirrored floorplan
 */

import type { CeilingHeight, ExteriorVariant, InteriorRole, StyleKind } from "./types";

export type FilenameGuess = {
  kind: "exterior" | "interior" | "bathroom" | "floorplan" | "unknown";
  styleId: string | null;
  role: InteriorRole | null;
  ceiling: CeilingHeight;
  variant: ExteriorVariant;
  mirror: boolean;
  bathroomHint: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");

const ROLE_PATTERNS: [RegExp, InteriorRole][] = [
  [/lighting\s*-?\s*dusk\s*-?\s*uplights?/i, "lighting_dusk_uplights"],
  [/uplights?/i, "lighting_dusk_uplights"],
  [/lighting\s*-?\s*dusk/i, "lighting_dusk"],
  [/lighting\s*-?\s*day(light|time)?/i, "lighting_daytime"],
  [/appliance\s*(mid|prem(ium)?)/i, "appliance_mid"],
  [/appliance\s*base/i, "appliance_base"],
  [/kitchen/i, "kitchen"],
  [/ambien[cs]e/i, "ambiance"],
];

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

type StyleRef = { id: string; name: string; kind: StyleKind };

/** Best style whose name appears in the file name, allowing small typos ("Vila Noir"). */
export function matchStyle(
  fileName: string,
  styles: StyleRef[],
): { style: StyleRef; exact: boolean } | null {
  const hay = squash(fileName);
  let best: { style: StyleRef; exact: boolean; score: number } | null = null;
  for (const style of styles) {
    const needle = squash(style.name);
    if (!needle) continue;
    if (hay.includes(needle)) {
      const score = needle.length * 10;
      if (!best || score > best.score) best = { style, exact: true, score };
      continue;
    }
    if (needle.length < 8) continue;
    for (let len = needle.length - 2; len <= needle.length + 2; len++) {
      for (let i = 0; i + len <= hay.length; i++) {
        if (distance(hay.slice(i, i + len), needle) <= 2) {
          const score = needle.length;
          if (!best || score > best.score) best = { style, exact: false, score };
          i = hay.length;
          len = needle.length + 3;
        }
      }
    }
  }
  return best ? { style: best.style, exact: best.exact } : null;
}

export function classifyFilename(fileName: string, styles: StyleRef[]): FilenameGuess {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const ceiling: CeilingHeight = /(\b9-1\b|9\s*-?\s*f(ee)?t|9-foot)/i.test(base) ? "9" : "8";
  const variant: ExteriorVariant = /\(P\)|(?<!non)porch/i.test(base) ? "porch" : "standard";
  const mirror = /\(REV\)|mirror|reversed/i.test(base);
  const role = ROLE_PATTERNS.find(([re]) => re.test(base))?.[1] ?? null;
  const bathroomHint = /shower/i.test(base)
    ? "shower"
    : /tub/i.test(base)
      ? "tub"
      : /bath/i.test(base)
        ? "bath"
        : null;

  const interiorStyles = styles.filter((s) => s.kind === "interior");
  const exteriorStyles = styles.filter((s) => s.kind === "exterior");

  if (/\bplan\b|floor\s*plan/i.test(base) && !role) {
    return {
      kind: "floorplan",
      styleId: null,
      role: null,
      ceiling,
      variant,
      mirror,
      bathroomHint: null,
      confidence: "high",
      reason: "File name mentions a plan",
    };
  }
  if (bathroomHint) {
    const match = matchStyle(base, interiorStyles);
    return {
      kind: "bathroom",
      styleId: match?.style.id ?? null,
      role: null,
      ceiling,
      variant,
      mirror: false,
      bathroomHint,
      confidence: match ? (match.exact ? "high" : "medium") : "low",
      reason: match
        ? `Bathroom for ${match.style.name}`
        : "Bathroom image; interior style not found in the name",
    };
  }
  if (role) {
    const match = matchStyle(base, interiorStyles);
    return {
      kind: "interior",
      styleId: match?.style.id ?? null,
      role,
      ceiling,
      variant,
      mirror: false,
      bathroomHint: null,
      confidence: match ? (match.exact ? "high" : "medium") : "low",
      reason: match
        ? match.exact
          ? "Style and rendering type found"
          : `Close match to “${match.style.name}” (check spelling)`
        : "Rendering type found; interior style not recognized",
    };
  }
  const ext = matchStyle(base, exteriorStyles);
  if (ext) {
    return {
      kind: "exterior",
      styleId: ext.style.id,
      role: null,
      ceiling,
      variant,
      mirror: false,
      bathroomHint: null,
      confidence: ext.exact ? "high" : "medium",
      reason: ext.exact
        ? "Exterior style found"
        : `Close match to “${ext.style.name}” (check spelling)`,
    };
  }
  return {
    kind: "unknown",
    styleId: null,
    role: null,
    ceiling,
    variant,
    mirror,
    bathroomHint: null,
    confidence: "low",
    reason: "Could not tell what this image shows",
  };
}
