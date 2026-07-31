import type { BuildertrendFields } from "./schemas";

export type BuildertrendFieldKey = keyof BuildertrendFields;

export type BuildertrendFieldDef = {
  key: BuildertrendFieldKey;
  /** Exact BuilderTrend field name used for copy/paste headers. */
  label: string;
  /** Optional Acton terminology clarification shown under the BT label. */
  hint?: string;
  /** When true, value is rendered as bullet list and copied with newline bullets. */
  isBulletList?: boolean;
  /** When true, display uses currency formatting and copy omits $. */
  isBudget?: boolean;
};

export const BUILDERTREND_FIELD_DEFS: BuildertrendFieldDef[] = [
  { key: "notesForInternalUsers", label: "Notes for internal users" },
  { key: "squareFeet", label: "Square Feet" },
  { key: "customerBudget", label: "Customer Budget", isBudget: true },
  { key: "customerStory", label: "Customer Story" },
  {
    key: "customerPain1",
    label: "Customer Type 1 Pain",
    hint: "Type 1 Pain — Why Build an ADU?",
  },
  {
    key: "customerPain",
    label: "Customer Type 2 Pain",
    hint: "Type 2 Pain — Why Acton / the Right Partner? (Customer Pain 2)",
  },
  { key: "customerPriorities", label: "Customer Priorities", isBulletList: true },
  { key: "designHandoff", label: "Design Handoff" },
  { key: "decisionMakingProcess", label: "Decision Making Process" },
  { key: "decisionDynamics", label: "Decision dynamics" },
  { key: "knownConcernsOrFears", label: "Known concerns or fears" },
  { key: "mustHaveFeatures", label: "Must-have features" },
  { key: "siteConstraints", label: "Site constraints" },
  { key: "soilUtilityNotes", label: "Soil / utility notes" },
  { key: "levelOfInvolvement", label: "Level of involvement" },
  { key: "internalStrategyNotes", label: "Internal Strategy Notes" },
  { key: "projectIntelligence", label: "Project Intelligence" },
  { key: "scheduleGoals", label: "Schedule Goals" },
  { key: "preferredContactMethod", label: "Preferred Contact Method" },
  { key: "salesCommitments", label: "Sales Commitments" },
  { key: "personalityTraits", label: "Personality Traits" },
  { key: "assumptionsDuringSales", label: "Assumptions During Sales" },
  { key: "scopeClarifications", label: "Scope Clarifications" },
  { key: "bedBathCount", label: "Bed / Bath count" },
  { key: "accessibilityRequirement", label: "Accessibility Requirement" },
  { key: "cityZoningFeedback", label: "City / zoning feedback" },
  { key: "accessConstructionIssue", label: "Access/construction issue" },
  { key: "responsivenessExpected", label: "Responsiveness expected" },
  { key: "nextSteps", label: "Next Steps" },
  { key: "recommendedBrModels", label: "Recommended BR Models" },
  { key: "projectType", label: "Project Type" },
];

const NOT_ESTABLISHED = "Not established";

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function parseNumeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function formatBudgetDisplay(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return NOT_ESTABLISHED;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function rawFieldValue(fields: BuildertrendFields, def: BuildertrendFieldDef): unknown {
  const base = fields[def.key];
  if (def.key === "customerPriorities" && fields.customerPrioritiesOther?.trim()) {
    const priorities = [...(fields.customerPriorities ?? [])];
    if (!priorities.includes("Other")) {
      priorities.push("Other");
    }
    return { list: priorities, other: fields.customerPrioritiesOther.trim() };
  }
  if (def.key === "projectType" && fields.projectTypeOther?.trim()) {
    return fields.projectType === "Other"
      ? `Other — ${fields.projectTypeOther.trim()}`
      : fields.projectType;
  }
  return base;
}

export function getDisplayValue(fields: BuildertrendFields, def: BuildertrendFieldDef): string {
  const value = rawFieldValue(fields, def);

  if (def.isBudget) {
    const n = parseNumeric(value);
    return n != null ? formatBudgetDisplay(n) : NOT_ESTABLISHED;
  }

  if (def.key === "customerPriorities") {
    const payload = value as { list?: string[]; other?: string } | string[] | null;
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.list)
        ? payload.list
        : [];
    const other = !Array.isArray(payload) ? payload?.other : undefined;
    if (list.length === 0 && !other) return NOT_ESTABLISHED;
    const items = [...list];
    if (other && list.includes("Other")) {
      const idx = items.indexOf("Other");
      if (idx >= 0) items[idx] = `Other — ${other}`;
    } else if (other) {
      items.push(`Other — ${other}`);
    }
    return items.join(", ");
  }

  if (def.isBulletList && Array.isArray(value)) {
    if (value.length === 0) return NOT_ESTABLISHED;
    return value.join(", ");
  }

  if (isEmptyValue(value)) return NOT_ESTABLISHED;
  if (typeof value === "number") return String(value);
  return String(value);
}

export function getCopyableValue(fields: BuildertrendFields, def: BuildertrendFieldDef): string {
  const value = rawFieldValue(fields, def);

  if (def.isBudget) {
    const n = parseNumeric(value);
    return n != null ? String(Math.round(n)) : "";
  }

  if (def.key === "customerPriorities") {
    const payload = value as { list?: string[]; other?: string } | string[] | null;
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.list)
        ? payload.list
        : [];
    const other = !Array.isArray(payload) ? payload?.other : undefined;
    if (list.length === 0 && !other) return "";
    const items = list.map((item) => (item === "Other" && other ? `Other — ${other}` : item));
    if (other && !list.includes("Other")) {
      items.push(`Other — ${other}`);
    }
    return items.map((item) => `- ${item}`).join("\n");
  }

  if (def.isBulletList && Array.isArray(value)) {
    if (value.length === 0) return "";
    return value.map((item) => `- ${item}`).join("\n");
  }

  if (isEmptyValue(value)) return "";
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

export function buildCopyAllFieldsText(fields: BuildertrendFields): string {
  const blocks: string[] = [];
  for (const def of BUILDERTREND_FIELD_DEFS) {
    const copyable = getCopyableValue(fields, def);
    if (copyable) {
      blocks.push(`${def.label}:\n${copyable}`);
    }
  }
  return blocks.join("\n\n");
}
