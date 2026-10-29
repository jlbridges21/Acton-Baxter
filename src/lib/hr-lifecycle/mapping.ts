/**
 * The document-to-workflow mapping as Markdown, generated from the catalog so the published
 * mapping (docs/hr-lifecycle/mapping.md) can never drift from the code. A unit test fails when
 * the file is out of date; regenerate it with UPDATE_LIFECYCLE_MAPPING=1.
 */

import { CHECKLIST_CATALOG, OFFBOARDING_AUTHORIZATION } from "./catalog";
import { ownerLabel } from "./plan";
import type { ChecklistCatalog, Condition, LifecycleItem, Timing } from "./types";
import { PHASE_LABELS, ROLE_KEY_LABELS } from "./types";

const STEP_LABELS: Record<string, string> = {
  manual_task: "Task",
  checklist: "Checklist",
  access_request: "Access (COO)",
  finance_handoff: "Finance",
  approval: "CEO/COO approval",
};

function timingText(t: Timing): string {
  const anchors: Record<string, string> = {
    offer_date: "offer date",
    start_date: "start date",
    notice_date: "notice date",
    last_day: "last day",
  };
  switch (t.kind) {
    case "none":
      return "No due date";
    case "final_pay":
      return "Final-pay rule (by separation type)";
    case "days":
      return t.offset === 0
        ? `On the ${anchors[t.anchor]}`
        : `${Math.abs(t.offset)} day(s) ${t.offset < 0 ? "before" : "after"} the ${anchors[t.anchor]}`;
    case "business_days":
      return `${t.offset} business day(s) after the ${anchors[t.anchor]}`;
    case "months":
      return `${t.offset} month(s) after the ${anchors[t.anchor]}`;
  }
}

function conditionText(c: Condition): string {
  switch (c.fact) {
    case "role":
      return `role: ${c.anyOf.map((r) => ROLE_KEY_LABELS[r]).join("/")}`;
    case "exempt":
      return c.equals ? "exempt only" : "non-exempt only";
    case "supervisor":
      return c.equals ? "supervisors only" : "non-supervisors only";
    case "headcount":
      return `headcount ${c.gte !== undefined ? `≥ ${c.gte}` : ""}${c.lte !== undefined ? ` ≤ ${c.lte}` : ""}`;
    case "on_group_health":
      return "on group health";
    case "separation":
      return `separation: ${c.anyOf.join("/")}`;
  }
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function row(i: LifecycleItem): string {
  const scope = [
    i.roles === "general" ? "All staff" : i.roles.map((r) => ROLE_KEY_LABELS[r]).join(", "),
    ...i.conditions.map(conditionText),
    ...i.subItems
      .filter((s) => s.conditions.length)
      .map((s) => `sub-item "${s.id}": ${s.conditions.map(conditionText).join(", ")}`),
  ].join("; ");
  return `| ${i.sourceRef.ordinal} | \`${i.id}\` | ${cell(i.text)} | ${i.tags.map((t) => `[${t}]`).join(" ") || "—"} | ${cell(scope)} | ${cell(timingText(i.timing))}${i.timingText ? ` (${cell(i.timingText)})` : ""} | ${ownerLabel(i.owner)} | ${STEP_LABELS[i.stepType] ?? i.stepType} | ${cell(i.citations.map((c) => `${c.reference} (${c.authority})`).join("; ")) || "—"} | ${i.dependsOn.map((d) => `\`${d}\``).join(", ") || "—"} |`;
}

export function mappingMarkdown(catalog: ChecklistCatalog = CHECKLIST_CATALOG): string {
  const out: string[] = [
    "# Staff Lifecycle Checklist → workflow mapping",
    "",
    `Generated from \`src/lib/hr-lifecycle/catalog.ts\` (document version ${catalog.documentVersion}). Do not edit by hand: run \`UPDATE_LIFECYCLE_MAPPING=1 npx vitest run tests/unit/hr-lifecycle.test.ts\`.`,
    "",
    "Each checkbox in the leadership document is one workflow step. The **Wording** column is the document's exact text (tags included); the step's title is a short label only. Timing for untagged items is an editable company default. Every [CA]/[Fed] deadline stays **unverified** in the verification register until a named reviewer checks the official source.",
    "",
    "Columns: # = position in the document section · Step id = workflow step key · Scope = who it applies to and conditions · Owner = default assignee role · Type = step type in Sam Operations.",
    "",
  ];
  for (const phase of ["preboarding", "onboarding", "offboarding"] as const) {
    const items = catalog.items.filter((i) => i.phase === phase);
    out.push(`## ${PHASE_LABELS[phase]} — ${items[0]?.sourceRef.part ?? ""}`, "");
    out.push(`${catalog.phaseGoals[phase]}`, "");
    if (phase === "offboarding")
      out.push(
        `**Added by Baxter (not in the document):** \`${OFFBOARDING_AUTHORIZATION.id}\` — ${OFFBOARDING_AUTHORIZATION.text} Every offboarding step depends on it.`,
        "",
      );
    for (const section of [...new Set(items.map((i) => i.sourceRef.section))]) {
      out.push(`### ${section}`, "");
      out.push(
        "| # | Step id | Wording | Tags | Scope | Timing | Owner | Type | Citations | Depends on |",
        "| - | ------- | ------- | ---- | ----- | ------ | ----- | ---- | --------- | ---------- |",
      );
      for (const i of items.filter((x) => x.sourceRef.section === section)) out.push(row(i));
      const withSubs = items.filter((x) => x.sourceRef.section === section && x.subItems.length);
      for (const i of withSubs) {
        out.push("", `Sub-items of \`${i.id}\` (each is a checklist tick):`, "");
        for (const s of i.subItems)
          out.push(`- \`${s.id}\`: ${s.text}${s.conditionNote ? ` — ${s.conditionNote}` : ""}`);
      }
      const flagged = items.filter((x) => x.sourceRef.section === section && x.flags.length);
      if (flagged.length) {
        out.push("", "Notes:", "");
        for (const i of flagged) for (const f of i.flags) out.push(`- \`${i.id}\`: ${f}`);
      }
      out.push("");
    }
  }
  out.push("## Recurring compliance calendar", "", catalog.recurringIntro, "");
  out.push(
    "| Id | Item | When | Requirement | Default owner | Notes |",
    "| -- | ---- | ---- | ----------- | ------------- | ----- |",
  );
  for (const r of catalog.recurring)
    out.push(
      `| \`${r.id}\` | ${cell(r.item)} | ${cell(r.when)} | ${cell(r.requirement)} | ${ownerLabel(r.defaultOwner)} | ${cell(r.flags.join(" ")) || "—"} |`,
    );
  out.push("", "## California compliance sources (verification register references)", "");
  for (const s of catalog.sources)
    out.push(
      `- ${s.name} — ${s.covers} — <${s.url}>${s.official ? "" : " (paid, not an official source)"}`,
    );
  out.push("", catalog.sourcesNote, "", "## Flags (from the document)", "");
  for (const f of catalog.flags) out.push(`- ${f}`);
  out.push("", "## How to use (from the document)", "");
  for (const h of catalog.howToUse) out.push(`- ${h}`);
  return `${out.join("\n")}\n`;
}
