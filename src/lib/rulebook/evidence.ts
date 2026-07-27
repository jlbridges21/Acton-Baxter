import "server-only";

/**
 * Evidence retrieval from Process Rulebook for Baxter AI integration.
 * Returns items compatible with BaxterContextItem shape.
 * Uses ACTIVE version only.
 */

import type { RulebookIntent, RulebookEvidenceItem } from "./types";
import { getActiveRulebook, loadRulebookTree } from "./versions";
import { noteActiveRulebookPresence } from "./capabilities";

/**
 * Detect the intent of a question related to the process rulebook.
 */
export function detectRulebookIntent(question: string): RulebookIntent {
  const lowerQuestion = question.toLowerCase();

  // Responsibility patterns
  if (
    lowerQuestion.includes("who is responsible") ||
    lowerQuestion.includes("who does") ||
    lowerQuestion.includes("who performs") ||
    lowerQuestion.includes("who executes") ||
    (lowerQuestion.includes("responsible") && lowerQuestion.includes("for"))
  ) {
    return "responsibility";
  }

  // Accountability patterns
  if (
    lowerQuestion.includes("who is accountable") ||
    lowerQuestion.includes("who approves") ||
    lowerQuestion.includes("who signs off") ||
    (lowerQuestion.includes("accountable") && lowerQuestion.includes("for"))
  ) {
    return "accountability";
  }

  // Consulted patterns
  if (
    lowerQuestion.includes("who should be consulted") ||
    lowerQuestion.includes("who needs to be consulted") ||
    lowerQuestion.includes("who to consult")
  ) {
    return "consulted";
  }

  // Informed patterns
  if (
    lowerQuestion.includes("who should be informed") ||
    lowerQuestion.includes("who needs to know") ||
    lowerQuestion.includes("who to notify")
  ) {
    return "informed";
  }

  // Stages patterns
  if (
    lowerQuestion.includes("what are the stages") ||
    lowerQuestion.includes("list the stages") ||
    lowerQuestion.includes("process stages") ||
    lowerQuestion.includes("what stages")
  ) {
    return "stages";
  }

  // Steps patterns
  if (
    lowerQuestion.includes("what are the steps") ||
    lowerQuestion.includes("list the steps") ||
    lowerQuestion.includes("process steps") ||
    lowerQuestion.includes("what steps")
  ) {
    return "steps";
  }

  // Required data patterns
  if (
    lowerQuestion.includes("what data") ||
    lowerQuestion.includes("required data") ||
    lowerQuestion.includes("what information") ||
    lowerQuestion.includes("what fields") ||
    lowerQuestion.includes("data requirements")
  ) {
    return "required_data";
  }

  // Process ownership patterns
  if (
    lowerQuestion.includes("who owns") ||
    lowerQuestion.includes("process owner") ||
    lowerQuestion.includes("ownership")
  ) {
    return "process_ownership";
  }

  // What comes after patterns
  if (
    lowerQuestion.includes("what comes after") ||
    lowerQuestion.includes("what's next") ||
    lowerQuestion.includes("next step") ||
    lowerQuestion.includes("what follows")
  ) {
    return "what_comes_after";
  }

  return "none";
}

/**
 * Retrieve rulebook evidence for a question.
 * Returns items compatible with BaxterContextItem shape.
 */
export async function retrieveRulebookEvidence(question: string): Promise<RulebookEvidenceItem[]> {
  const intent = detectRulebookIntent(question);

  if (intent === "none") {
    return [];
  }

  const active = await getActiveRulebook().catch(() => null);
  if (!active) {
    noteActiveRulebookPresence(false);
    return [];
  }

  noteActiveRulebookPresence(true);

  const tree = await loadRulebookTree(active.id);
  if (!tree) {
    return [];
  }

  const items: RulebookEvidenceItem[] = [];
  let itemNumber = 1;

  // Extract relevant evidence based on intent
  switch (intent) {
    case "responsibility":
    case "accountability":
    case "consulted":
    case "informed": {
      const targetRaci =
        intent === "responsibility"
          ? "R"
          : intent === "accountability"
            ? "A"
            : intent === "consulted"
              ? "C"
              : "I";

      for (const stage of tree.stages) {
        for (const step of stage.steps) {
          const relevantRaci = step.raci.filter((r) => r.raci === targetRaci);

          if (relevantRaci.length > 0) {
            const roles = relevantRaci.map((r) => r.role_key).join(", ");
            items.push({
              number: itemNumber++,
              id: `step-${step.id}`,
              title: `${step.display_name} — ${stage.display_name}`,
              summary: `${targetRaci}: ${roles}`,
              contentExcerpt: `**Step:** ${step.display_name}\n**Stage:** ${stage.display_name}\n**${targetRaci}:** ${roles}\n${step.description || ""}`,
              category: "Process Rulebook",
              tags: [stage.stage_key, step.step_key],
              sourceName: `Process Rulebook v${tree.version_number}`,
              sourceUrl: null,
              sourceType: "process_rulebook",
              mimeType: null,
              updatedAt: tree.updated_at,
              citationLabel: `Process Rulebook v${tree.version_number} — ${step.display_name}`,
              relevanceScore: 0.95,
            });
          }
        }
      }
      break;
    }

    case "stages": {
      for (const stage of tree.stages) {
        items.push({
          number: itemNumber++,
          id: `stage-${stage.id}`,
          title: stage.display_name,
          summary: `Stage ${stage.order_index + 1}: ${stage.display_name}`,
          contentExcerpt: `**Stage ${stage.order_index + 1}:** ${stage.display_name}\n**Duration:** ${stage.duration_days_budget || "Not specified"} days\n${stage.description || ""}`,
          category: "Process Rulebook",
          tags: [stage.stage_key],
          sourceName: `Process Rulebook v${tree.version_number}`,
          sourceUrl: null,
          sourceType: "process_rulebook",
          mimeType: null,
          updatedAt: tree.updated_at,
          citationLabel: `Process Rulebook v${tree.version_number} — ${stage.display_name}`,
          relevanceScore: 0.9,
        });
      }
      break;
    }

    case "steps": {
      for (const stage of tree.stages) {
        for (const step of stage.steps) {
          const responsible = step.raci.find((r) => r.raci === "R");
          const accountable = step.raci.find((r) => r.raci === "A");

          items.push({
            number: itemNumber++,
            id: `step-${step.id}`,
            title: `${step.display_name} — ${stage.display_name}`,
            summary: `Step ${step.order_index + 1} in ${stage.display_name}`,
            contentExcerpt: `**Step:** ${step.display_name}\n**Stage:** ${stage.display_name}\n**Duration:** ${step.duration_days_budget || "Not specified"} days\n**Responsible:** ${responsible?.role_key || "Not assigned"}\n**Accountable:** ${accountable?.role_key || "Not assigned"}\n${step.description || ""}`,
            category: "Process Rulebook",
            tags: [stage.stage_key, step.step_key],
            sourceName: `Process Rulebook v${tree.version_number}`,
            sourceUrl: null,
            sourceType: "process_rulebook",
            mimeType: null,
            updatedAt: tree.updated_at,
            citationLabel: `Process Rulebook v${tree.version_number} — ${step.display_name}`,
            relevanceScore: 0.9,
          });
        }
      }
      break;
    }

    case "required_data": {
      for (const stage of tree.stages) {
        for (const step of stage.steps) {
          if (step.data_requirements.length > 0) {
            const reqFields = step.data_requirements
              .map(
                (req) =>
                  `- ${req.display_name} (${req.source_system})${req.required ? " *required*" : ""}`,
              )
              .join("\n");

            items.push({
              number: itemNumber++,
              id: `step-data-${step.id}`,
              title: `Data Requirements: ${step.display_name}`,
              summary: `${step.data_requirements.length} data fields required`,
              contentExcerpt: `**Step:** ${step.display_name}\n**Stage:** ${stage.display_name}\n**Required Data:**\n${reqFields}`,
              category: "Process Rulebook",
              tags: [stage.stage_key, step.step_key, "data_requirements"],
              sourceName: `Process Rulebook v${tree.version_number}`,
              sourceUrl: null,
              sourceType: "process_rulebook",
              mimeType: null,
              updatedAt: tree.updated_at,
              citationLabel: `Process Rulebook v${tree.version_number} — ${step.display_name}`,
              relevanceScore: 0.95,
            });
          }
        }
      }
      break;
    }

    case "process_ownership": {
      // Find all Accountable roles across the process
      const accountableRoles = new Set<string>();
      for (const stage of tree.stages) {
        for (const step of stage.steps) {
          const accountable = step.raci.filter((r) => r.raci === "A");
          accountable.forEach((a) => accountableRoles.add(a.role_key));
        }
      }

      if (accountableRoles.size > 0) {
        items.push({
          number: itemNumber++,
          id: `process-ownership`,
          title: "Process Ownership",
          summary: `Accountable roles in the process`,
          contentExcerpt: `**Process Owners (Accountable):**\n${[...accountableRoles].map((r) => `- ${r}`).join("\n")}`,
          category: "Process Rulebook",
          tags: ["ownership", "accountable"],
          sourceName: `Process Rulebook v${tree.version_number}`,
          sourceUrl: null,
          sourceType: "process_rulebook",
          mimeType: null,
          updatedAt: tree.updated_at,
          citationLabel: `Process Rulebook v${tree.version_number}`,
          relevanceScore: 0.85,
        });
      }
      break;
    }

    case "what_comes_after": {
      // For this intent, we'd need to parse the question to find which step/stage they're asking about
      // For now, return all steps in order
      for (const stage of tree.stages) {
        for (let i = 0; i < stage.steps.length; i++) {
          const step = stage.steps[i];
          if (!step) continue;
          const nextStep = stage.steps[i + 1];
          const nextStage = tree.stages[stage.order_index + 1];

          let nextInfo = "";
          if (nextStep) {
            nextInfo = `Next: ${nextStep.display_name}`;
          } else if (nextStage) {
            nextInfo = `Next: ${nextStage.display_name} (next stage)`;
          } else {
            nextInfo = "This is the final step";
          }

          items.push({
            number: itemNumber++,
            id: `step-next-${step.id}`,
            title: `After ${step.display_name}`,
            summary: nextInfo,
            contentExcerpt: `**Current Step:** ${step.display_name}\n**Stage:** ${stage.display_name}\n**${nextInfo}**`,
            category: "Process Rulebook",
            tags: [stage.stage_key, step.step_key, "sequence"],
            sourceName: `Process Rulebook v${tree.version_number}`,
            sourceUrl: null,
            sourceType: "process_rulebook",
            mimeType: null,
            updatedAt: tree.updated_at,
            citationLabel: `Process Rulebook v${tree.version_number} — ${step.display_name}`,
            relevanceScore: 0.9,
          });
        }
      }
      break;
    }
  }

  return items;
}
