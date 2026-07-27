import type { CanonicalSource } from "./types";
import { BAXTER_GOVERNANCE_VERSION, BAXTER_RUNTIME_VERSION } from "./version";

/**
 * Registry of governing Baxter/Acton documents.
 * Do not detect these by filename substring elsewhere in the app.
 */
export const BAXTER_CANONICAL_SOURCES: Record<string, CanonicalSource> = {
  runtime: {
    id: "runtime",
    title: "Baxter Runtime System Prompt",
    path: "docs/baxter/baxter-runtime-prompt-v1-1.md",
    version: BAXTER_RUNTIME_VERSION,
    purpose: "Permanent Baxter behavior distilled into every reasoning request",
    runtimeRole: "always",
    indexable: false,
    citable: false,
    mayContainUnresolved: false,
  },
  governance: {
    id: "governance",
    title: "Baxter Governance Document",
    path: "docs/baxter/baxter-governance-v1-1.md",
    version: BAXTER_GOVERNANCE_VERSION,
    purpose: "Change control, risks, placeholders — admin only; not employee policy",
    runtimeRole: "admin_only",
    indexable: false,
    citable: false,
    mayContainUnresolved: true,
  },
  culture: {
    id: "culture",
    title: "Acton ADU Culture Guide",
    path: "docs/baxter/Acton-ADU-Culture-Guide-2026.md",
    version: "2026",
    purpose: "Operating principles and teammate behaviors",
    runtimeRole: "always",
    indexable: true,
    citable: true,
    mayContainUnresolved: false,
  },
  brand: {
    id: "brand",
    title: "Acton ADU Brand Guide",
    path: "docs/baxter/Acton-ADU-Brand-Guide.md",
    version: "1",
    purpose: "Voice and service attributes",
    runtimeRole: "always",
    indexable: true,
    citable: true,
    mayContainUnresolved: false,
  },
  valueProposition: {
    id: "value_proposition",
    title: "Value Proposition Playbook",
    path: "docs/baxter/Value-Proposition-Playbook.md",
    version: "1",
    purpose: "Sales/positioning for customer-facing drafts and value questions",
    runtimeRole: "conditional",
    indexable: true,
    citable: true,
    mayContainUnresolved: false,
  },
};

export function listCanonicalSources(): CanonicalSource[] {
  return Object.values(BAXTER_CANONICAL_SOURCES);
}

export function listRuntimeAlwaysStandards(): CanonicalSource[] {
  return listCanonicalSources().filter((s) => s.runtimeRole === "always" && s.id !== "runtime");
}
