/**
 * Reading the leadership checklist document and reconciling it with the structured catalog.
 *
 * parseChecklistHtml() is pure (mammoth's HTML → parts, sections, checkbox items, tables,
 * flags). reconcile() compares a parsed document with a catalog: every checkbox must map to
 * exactly one item with identical wording, or it is reported as changed, added, or removed.
 * A new document version never edits running cases; it produces a reviewed draft.
 */

import { CHECKLIST_CATALOG, jurisdictionOf, tagsIn } from "./catalog";
import type { ChecklistCatalog, LifecycleItem, LifecyclePhase } from "./types";

export type ParsedItem = {
  part: string;
  section: string;
  ordinal: number;
  text: string;
  subItems: string[];
};

export type ParsedTable = { part: string; section: string; rows: string[][] };

export type ParsedChecklist = {
  title: string;
  dateLine: string;
  parts: string[];
  sections: Array<{ part: string; section: string }>;
  items: ParsedItem[];
  tables: ParsedTable[];
  /** Bullets that are not checkboxes and not sub-items (the Flags part). */
  notes: Array<{ part: string; text: string }>;
  paragraphs: Array<{ part: string; section: string; text: string }>;
};

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize quotes and spaces for wording comparison (the wording itself is kept as-is). */
export function normalizeWording(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/** Parse mammoth's HTML for the checklist. Tolerant of extra paragraphs and tables. */
export function parseChecklistHtml(html: string): ParsedChecklist {
  const out: ParsedChecklist = {
    title: "",
    dateLine: "",
    parts: [],
    sections: [],
    items: [],
    tables: [],
    notes: [],
    paragraphs: [],
  };
  let part = "";
  let section = "";
  const ordinals = new Map<string, number>();
  const tokens =
    html.match(/<\/?(h1|h2|h3|p|ul|ol|li|table|tr|td|th)\b[^>]*>|[^<]+|<[^>]+>/g) ?? [];
  let depth = 0; // list nesting
  const liStack: Array<{ text: string; subs: string[]; depth: number }> = [];
  let capture: { tag: string; text: string } | null = null;
  let table: ParsedTable | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;
  let afterFirstH1 = false;

  const finishLi = () => {
    const li = liStack.pop();
    if (!li) return;
    const text = decode(li.text);
    if (li.depth >= 2) {
      const parent = liStack[liStack.length - 1];
      if (parent) parent.subs.push(text);
      return;
    }
    if (text.startsWith("☐")) {
      const key = `${part}|${section}`;
      const ordinal = (ordinals.get(key) ?? 0) + 1;
      ordinals.set(key, ordinal);
      out.items.push({ part, section, ordinal, text, subItems: li.subs });
    } else if (text) {
      out.notes.push({ part, text });
    }
  };

  for (const tok of tokens) {
    const m = tok.match(/^<(\/?)(h1|h2|h3|p|ul|ol|li|table|tr|td|th)\b/);
    if (!m) {
      if (capture) capture.text += tok;
      else if (cell !== null) cell += tok;
      else if (liStack.length) liStack[liStack.length - 1]!.text += tok;
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2]!;
    if (["h1", "h2", "h3"].includes(tag)) {
      if (!closing) capture = { tag, text: "" };
      else if (capture) {
        const text = decode(capture.text);
        if (tag === "h1") {
          out.title ||= text;
          afterFirstH1 = true;
        } else if (tag === "h2") {
          part = text;
          section = "";
          out.parts.push(text);
        } else {
          section = text;
          out.sections.push({ part, section });
        }
        capture = null;
      }
      continue;
    }
    if (tag === "p") {
      if (cell !== null || liStack.length) continue; // paragraphs inside cells / list items
      if (!closing) capture = { tag, text: "" };
      else if (capture) {
        const text = decode(capture.text);
        if (afterFirstH1 && !out.dateLine && !part) out.dateLine = text;
        else if (text) out.paragraphs.push({ part, section, text });
        capture = null;
      }
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      depth += closing ? -1 : 1;
      continue;
    }
    if (tag === "li") {
      if (!closing) liStack.push({ text: "", subs: [], depth });
      else finishLi();
      continue;
    }
    if (tag === "table") {
      if (!closing) table = { part, section, rows: [] };
      else if (table) {
        out.tables.push(table);
        table = null;
      }
      continue;
    }
    if (tag === "tr") {
      if (!closing) row = [];
      else if (row && table) {
        table.rows.push(row);
        row = null;
      }
      continue;
    }
    if (tag === "td" || tag === "th") {
      if (!closing) cell = "";
      else if (cell !== null && row) {
        row.push(decode(cell));
        cell = null;
      }
    }
  }
  return out;
}

export async function parseChecklistDocx(buffer: Buffer): Promise<ParsedChecklist> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ buffer });
  return parseChecklistHtml(value);
}

/** Which lifecycle phase a document part belongs to (by its "Part N" heading). */
export function phaseForPart(part: string): LifecyclePhase | null {
  const p = part.toLowerCase();
  if (/pre-?boarding/.test(p)) return "preboarding";
  if (/offboarding/.test(p)) return "offboarding";
  if (/onboarding/.test(p)) return "onboarding";
  return null;
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeWording(s)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}
function jaccard(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

export type Reconciliation = {
  matched: Array<{ itemId: string; parsed: ParsedItem }>;
  changed: Array<{
    itemId: string;
    previousText: string;
    newText: string;
    parsed: ParsedItem;
    subItemsChanged: boolean;
  }>;
  added: ParsedItem[];
  removed: Array<{ itemId: string; text: string }>;
  recurringChanged: Array<{ id: string | null; previous: string | null; next: string | null }>;
  flagsChanged: boolean;
  structureNotes: string[];
};

/** Compare a parsed document with a catalog. Exact wording first, then best same-section match. */
export function reconcile(
  parsed: ParsedChecklist,
  catalog: ChecklistCatalog = CHECKLIST_CATALOG,
): Reconciliation {
  const docItems = catalog.items.filter((i) => i.origin === "document");
  const unmatchedParsed = new Set(parsed.items);
  const result: Reconciliation = {
    matched: [],
    changed: [],
    added: [],
    removed: [],
    recurringChanged: [],
    flagsChanged: false,
    structureNotes: [],
  };
  const pending: LifecycleItem[] = [];
  const sameSubs = (item: LifecycleItem, p: ParsedItem) =>
    item.subItems.length === p.subItems.length &&
    item.subItems.every(
      (s, i) => normalizeWording(s.text) === normalizeWording(p.subItems[i] ?? ""),
    );
  for (const item of docItems) {
    const exact = [...unmatchedParsed].find(
      (p) => normalizeWording(p.text) === normalizeWording(item.text),
    );
    if (exact) {
      unmatchedParsed.delete(exact);
      if (sameSubs(item, exact)) result.matched.push({ itemId: item.id, parsed: exact });
      else
        result.changed.push({
          itemId: item.id,
          previousText: item.text,
          newText: exact.text,
          parsed: exact,
          subItemsChanged: true,
        });
    } else pending.push(item);
  }
  for (const item of pending) {
    let best: ParsedItem | null = null;
    let score = 0;
    for (const p of unmatchedParsed) {
      if (phaseForPart(p.part) !== item.phase || p.section !== item.sourceRef.section) continue;
      const s = jaccard(p.text, item.text);
      if (s > score) {
        best = p;
        score = s;
      }
    }
    if (best && score >= 0.4) {
      unmatchedParsed.delete(best);
      result.changed.push({
        itemId: item.id,
        previousText: item.text,
        newText: best.text,
        parsed: best,
        subItemsChanged: !sameSubs(item, best),
      });
    } else result.removed.push({ itemId: item.id, text: item.text });
  }
  result.added = [...unmatchedParsed];

  const recurringTable = parsed.tables.find((t) => /recurring/i.test(t.part));
  const rows = (recurringTable?.rows ?? []).slice(1).map((r) => r.join(" | "));
  const known = catalog.recurring.map((r) => [r.item, r.when, r.requirement].join(" | "));
  for (const [i, r] of catalog.recurring.entries())
    if (!rows.some((x) => normalizeWording(x) === normalizeWording(known[i]!)))
      result.recurringChanged.push({ id: r.id, previous: known[i]!, next: null });
  for (const x of rows)
    if (!known.some((k) => normalizeWording(k) === normalizeWording(x)))
      result.recurringChanged.push({ id: null, previous: null, next: x });

  const flagNotes = parsed.notes.filter((n) => /^flags?$/i.test(n.part)).map((n) => n.text);
  result.flagsChanged =
    flagNotes.length !== catalog.flags.length ||
    flagNotes.some((f, i) => normalizeWording(f) !== normalizeWording(catalog.flags[i] ?? ""));

  for (const phase of ["preboarding", "onboarding", "offboarding"] as const)
    if (!parsed.parts.some((p) => phaseForPart(p) === phase))
      result.structureNotes.push(`No ${phase} part was found in the document.`);
  return result;
}

/**
 * A catalog for a new document version: matched items keep their mapping; changed items keep
 * their mapping with the new wording and a review flag; added items get safe defaults (HR owns
 * them, no due date) flagged for review; removed items are dropped. The previous version's
 * history is untouched.
 */
export function catalogForNewVersion(
  base: ChecklistCatalog,
  parsed: ParsedChecklist,
  version: string,
): { catalog: ChecklistCatalog; reconciliation: Reconciliation } {
  const rec = reconcile(parsed, base);
  const changedById = new Map(rec.changed.map((c) => [c.itemId, c]));
  const removed = new Set(rec.removed.map((r) => r.itemId));
  const items: LifecycleItem[] = [];
  for (const item of base.items) {
    if (removed.has(item.id)) continue;
    const ch = changedById.get(item.id);
    const matched = rec.matched.find((m) => m.itemId === item.id);
    const parsedItem = ch?.parsed ?? matched?.parsed;
    const tags = ch ? tagsIn(ch.newText) : item.tags;
    items.push({
      ...item,
      text: ch ? ch.newText : item.text,
      tags,
      jurisdiction: jurisdictionOf(tags),
      subItems: ch?.subItemsChanged
        ? ch.parsed.subItems.map((text, i) => {
            const prev = item.subItems.find(
              (s) => normalizeWording(s.text) === normalizeWording(text),
            );
            return prev ?? { id: `${item.id.slice(0, 20)}-s${i + 1}`, text, conditions: [] };
          })
        : item.subItems,
      sourceRef: {
        ...item.sourceRef,
        documentVersion: version,
        ...(parsedItem
          ? { part: parsedItem.part, section: parsedItem.section, ordinal: parsedItem.ordinal }
          : {}),
      },
      flags: ch
        ? [
            `Wording changed in document version ${version}. Previous wording: "${ch.previousText}". Review owner, timing, and conditions.`,
            ...item.flags,
          ]
        : item.flags,
    });
  }
  for (const [i, p] of rec.added.entries()) {
    const phase = phaseForPart(p.part);
    if (!phase) continue;
    const tags = tagsIn(p.text);
    items.push({
      id: `new-${phase.slice(0, 3)}-${version.replace(/[^0-9]/g, "").slice(-8)}-${i + 1}`,
      phase,
      origin: "document",
      sourceRef: {
        documentKey: base.documentKey,
        documentVersion: version,
        part: p.part,
        section: p.section,
        ordinal: p.ordinal,
      },
      text: p.text,
      title: p.text
        .replace(/^☐\s*/, "")
        .replace(/\[(CA|Fed)\]\s*/g, "")
        .slice(0, 150),
      subItems: p.subItems.map((text, j) => ({ id: `s${j + 1}`, text, conditions: [] })),
      tags,
      jurisdiction: jurisdictionOf(tags),
      roles: "general",
      conditions: [],
      trigger: "",
      timing: { kind: "none" },
      timingText: "",
      owner: "hr_admin",
      stepType: p.subItems.length ? "checklist" : "manual_task",
      documents: [],
      platforms: [],
      approvals: [],
      citations: [],
      dependsOn: [],
      privilegedAccess: false,
      communication: null,
      flags: [
        `New in document version ${version}. Review the owner, timing, role scope, conditions, and citations before publishing.`,
      ],
    });
  }
  return {
    catalog: { ...base, documentVersion: version, items },
    reconciliation: rec,
  };
}
