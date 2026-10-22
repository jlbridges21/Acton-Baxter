/** Field-level comparison of two agent configurations (shared by server and UI). */

import type { AgentConfig } from "./types";

export type ConfigChange = { path: string; label: string; before: string; after: string };

const FIELD_LABELS: Record<string, string> = {
  "instructions.identity": "Who this agent is",
  "instructions.tone": "Tone",
  "instructions.objectives": "Objectives",
  "instructions.responsibilities": "Responsibilities",
  "instructions.rules": "Operating rules",
  "instructions.boundaries": "Scope boundaries",
  "instructions.delegationGuidelines": "Delegation guidelines",
  "instructions.escalation": "Escalation",
  "instructions.outputPreferences": "Output preferences",
  "model.provider": "AI provider",
  "model.model": "AI model",
  "model.source": "Model source",
  "tools.enabled": "Enabled tools",
};

function flatten(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = Array.isArray(value) ? value.join("\n") : value == null ? "" : String(value);
  }
  return out;
}

export function diffConfigs(before: AgentConfig, after: AgentConfig): ConfigChange[] {
  const a = flatten(before);
  const b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((path) => (a[path] ?? "") !== (b[path] ?? ""))
    .sort()
    .map((path) => ({
      path,
      label:
        FIELD_LABELS[path] ??
        path
          .split(".")
          .map((p) => p.replace(/([A-Z])/g, " $1").toLowerCase())
          .join(" › "),
      before: a[path] ?? "",
      after: b[path] ?? "",
    }));
}
