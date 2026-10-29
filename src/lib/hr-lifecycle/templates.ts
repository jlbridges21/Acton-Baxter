/**
 * HR lifecycle workflow templates (pure): the checklist catalog becomes three versioned Sam
 * Operations workflow definitions (pre-boarding, onboarding, offboarding). Each checkbox is one
 * step whose `lifecycle` metadata keeps the exact wording and source reference, so every task in
 * a running case traces back to the document version it came from.
 *
 * Also: reading items back out of a (possibly edited) definition, no-code item edits, and the
 * list of compliance changes that force a recorded review before publishing.
 */

import {
  workflowDefinitionSchema,
  type AssigneeRole,
  type StepDefinition,
  type WorkflowDefinition,
} from "@/lib/ops/definition";
import { CHECKLIST_CATALOG, OFFBOARDING_AUTHORIZATION, itemsForPhase } from "./catalog";
import type {
  ChecklistCatalog,
  Condition,
  LifecycleItem,
  LifecyclePhase,
  RoleKey,
  Timing,
} from "./types";
import { PHASE_LABELS } from "./types";

export const LIFECYCLE_TEMPLATE_KEYS: Record<LifecyclePhase, string> = {
  preboarding: "lifecycle-preboarding",
  onboarding: "lifecycle-onboarding",
  offboarding: "lifecycle-offboarding",
};

export const LIFECYCLE_TEMPLATE_NAMES: Record<LifecyclePhase, string> = {
  preboarding: "Staff lifecycle: Pre-boarding",
  onboarding: "Staff lifecycle: Onboarding (Day 1 to 90)",
  offboarding: "Staff lifecycle: Offboarding",
};

const ANCHOR: Record<LifecyclePhase, WorkflowDefinition["anchor"]> = {
  preboarding: "start_date",
  onboarding: "start_date",
  offboarding: "end_date",
};

function inputsFor(phase: LifecyclePhase): WorkflowDefinition["inputs"] {
  if (phase === "offboarding")
    return [
      { key: "notice_date", label: "Notice received", type: "date", required: true },
      { key: "end_date", label: "Last day", type: "date", required: true },
      { key: "separation_type", label: "Separation type", type: "text", required: true },
      { key: "hiring_manager", label: "Manager", type: "person", required: false },
    ];
  return [
    { key: "offer_date", label: "Offer date", type: "date", required: phase === "preboarding" },
    { key: "start_date", label: "Start date", type: "date", required: true },
    { key: "hiring_manager", label: "Hiring manager", type: "person", required: false },
  ];
}

function stepFor(item: LifecycleItem, phase: LifecyclePhase): StepDefinition {
  const anchorKey = phase === "offboarding" ? "last_day" : "start_date";
  const dueOffsetDays =
    item.timing.kind === "days" && item.timing.anchor === anchorKey ? item.timing.offset : null;
  return {
    key: item.id,
    title: item.title.slice(0, 160),
    description: item.text.slice(0, 2000),
    type: item.stepType,
    stage: item.sourceRef.section.slice(0, 60),
    assignee: { role: item.owner as AssigneeRole, profileId: null },
    dependsOn: item.dependsOn,
    dueOffsetDays,
    reminder: { everyDays: null, escalateAfterDays: null },
    evidenceRequired: item.tags.length > 0 || item.stepType === "access_request",
    checklist: item.subItems.map((s) => s.text.slice(0, 200)),
    fields: [],
    documentCategory: "",
    message: {
      channel: "email",
      recipient: "employee",
      customRecipient: "",
      subject: "",
      body: "",
    },
    action: { type: null, settings: {} },
    waitOffsetDays: null,
    lifecycle: item,
  };
}

/** Build one phase's workflow definition from a catalog. */
export function definitionFromCatalog(
  phase: LifecyclePhase,
  catalog: ChecklistCatalog = CHECKLIST_CATALOG,
  sourceId: string | null = null,
): WorkflowDefinition {
  const items = [
    ...(phase === "offboarding" ? [OFFBOARDING_AUTHORIZATION] : []),
    ...itemsForPhase(phase, catalog),
  ];
  const known = new Set(items.map((i) => i.id));
  const steps = items.map((i) => {
    let deps = i.dependsOn.filter((d) => known.has(d));
    // Offboarding: nothing starts before leadership authorizes the separation.
    if (phase === "offboarding" && i.origin === "document" && !deps.length)
      deps = [OFFBOARDING_AUTHORIZATION.id];
    return stepFor({ ...i, dependsOn: deps }, phase);
  });
  const stages = [...new Set(steps.map((s) => s.stage))].filter(Boolean).slice(0, 12);
  return workflowDefinitionSchema.parse({
    anchor: ANCHOR[phase],
    inputs: inputsFor(phase),
    entities: [],
    stages,
    steps,
    lifecycle: {
      phase,
      documentKey: catalog.documentKey,
      documentVersion: catalog.documentVersion,
      sourceId,
    },
  });
}

/**
 * The lifecycle items of a definition, with the editable step fields (title, owner, order,
 * dependencies) taking precedence over the stored metadata.
 */
export function itemsFromDefinition(def: WorkflowDefinition): LifecycleItem[] {
  return def.steps
    .filter((s) => s.lifecycle)
    .map((s) => ({
      ...s.lifecycle!,
      title: s.title,
      owner: s.assignee.role === "specific_person" ? s.lifecycle!.owner : s.assignee.role,
      stepType: s.type,
      dependsOn: s.dependsOn,
    }));
}

// ---------------------------------------------------------------------------
// No-code edits
// ---------------------------------------------------------------------------
export type ItemEdit = {
  itemId: string;
  title?: string;
  /** The checklist wording. Changing a legal item's wording is a compliance change. */
  text?: string;
  owner?: AssigneeRole;
  timing?: Timing;
  timingText?: string;
  roles?: "general" | RoleKey[];
  conditions?: Condition[];
  dependsOn?: string[];
  communication?: string | null;
  flags?: string[];
  /** Move to this 0-based position within the definition. */
  position?: number;
};

export function applyItemEdits(def: WorkflowDefinition, edits: ItemEdit[]): WorkflowDefinition {
  let steps = [...def.steps];
  for (const e of edits) {
    const idx = steps.findIndex((s) => s.key === e.itemId);
    if (idx < 0) throw new Error(`Unknown checklist item "${e.itemId}".`);
    const s = steps[idx]!;
    const meta = s.lifecycle;
    if (!meta) throw new Error(`"${s.title}" is not a checklist item.`);
    const nextMeta: LifecycleItem = {
      ...meta,
      ...(e.title !== undefined ? { title: e.title } : {}),
      ...(e.text !== undefined ? { text: e.text } : {}),
      ...(e.timing !== undefined ? { timing: e.timing } : {}),
      ...(e.timingText !== undefined ? { timingText: e.timingText } : {}),
      ...(e.roles !== undefined ? { roles: e.roles } : {}),
      ...(e.conditions !== undefined ? { conditions: e.conditions } : {}),
      ...(e.dependsOn !== undefined ? { dependsOn: e.dependsOn } : {}),
      ...(e.communication !== undefined ? { communication: e.communication } : {}),
      ...(e.flags !== undefined ? { flags: e.flags } : {}),
      ...(e.owner !== undefined ? { owner: e.owner } : {}),
    };
    const phaseAnchor = def.lifecycle?.phase === "offboarding" ? "last_day" : "start_date";
    const updated: StepDefinition = {
      ...s,
      title: (e.title ?? s.title).slice(0, 160),
      description: (e.text ?? s.description).slice(0, 2000),
      assignee: e.owner ? { role: e.owner, profileId: null } : s.assignee,
      dependsOn: e.dependsOn ?? s.dependsOn,
      dueOffsetDays:
        nextMeta.timing.kind === "days" && nextMeta.timing.anchor === phaseAnchor
          ? nextMeta.timing.offset
          : null,
      lifecycle: nextMeta,
    };
    steps[idx] = updated;
    if (e.position !== undefined) {
      steps = steps.filter((_, i) => i !== idx);
      steps.splice(Math.max(0, Math.min(e.position, steps.length)), 0, updated);
    }
  }
  return workflowDefinitionSchema.parse({ ...def, steps });
}

// ---------------------------------------------------------------------------
// Compliance review
// ---------------------------------------------------------------------------
const COMPLIANCE_FIELDS: Array<keyof LifecycleItem> = [
  "text",
  "subItems",
  "tags",
  "timing",
  "conditions",
  "roles",
  "citations",
  "stepType",
  "owner",
];

/** Item ids whose legal content changed between two definitions. */
export function changedComplianceItems(
  prev: WorkflowDefinition | null,
  next: WorkflowDefinition,
): string[] {
  const before = new Map((prev ? itemsFromDefinition(prev) : []).map((i) => [i.id, i]));
  const after = itemsFromDefinition(next);
  const ids = new Set<string>();
  for (const i of after) {
    const p = before.get(i.id);
    if (!i.tags.length && !(p && p.tags.length)) continue;
    if (!p || COMPLIANCE_FIELDS.some((f) => JSON.stringify(p[f]) !== JSON.stringify(i[f])))
      ids.add(i.id);
  }
  for (const [id, p] of before) if (p.tags.length && !after.some((i) => i.id === id)) ids.add(id);
  return [...ids];
}

/** Human-readable compliance changes (empty = no legal item changed). */
export function complianceChanges(
  prev: WorkflowDefinition | null,
  next: WorkflowDefinition,
): string[] {
  if (!prev) return []; // the first published version is reviewed through the verification register
  const before = new Map(itemsFromDefinition(prev).map((i) => [i.id, i]));
  const after = new Map(itemsFromDefinition(next).map((i) => [i.id, i]));
  return changedComplianceItems(prev, next).map((id) => {
    const p = before.get(id);
    const n = after.get(id);
    if (!n) return `Removed legal item "${p!.title}".`;
    if (!p) return `Added legal item "${n.title}".`;
    const fields = COMPLIANCE_FIELDS.filter((f) => JSON.stringify(p[f]) !== JSON.stringify(n[f]));
    return `Changed legal item "${n.title}": ${fields.join(", ")}.`;
  });
}

export function templateDescription(phase: LifecyclePhase, version: string): string {
  return `${PHASE_LABELS[phase]} from the leadership Staff Lifecycle Checklist (document version ${version}). Each task keeps the document's wording and source reference. Legal timing stays unverified until a named reviewer checks it.`;
}
