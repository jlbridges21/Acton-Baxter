/**
 * Regression: named-entity / #channel asks must not become capability how-tos,
 * and project-info questions must attempt Slack → PEM → GHL rather than skipping.
 */
import { describe, expect, it } from "vitest";
import {
  classifyCapabilityQuestion,
  isBaxterCapabilityMetaHowto,
  questionHasSpecificNamedEntity,
} from "@/lib/baxter/capability-intent";
import { answerCapabilityHelp } from "@/lib/baxter/capability-help";
import { resolveQuestionEntity, runEvidenceRegistry } from "@/lib/baxter-ai/evidence-registry";
import { ghlEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/ghl";
import { pemEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/pem";
import type { SemanticQuestionClassification } from "@/lib/baxter-ai/semantic-question-classification";
import type { EvidenceSourceHandleInput } from "@/lib/baxter-ai/evidence-registry/types";
import { detectSlackSearchIntent, extractChannelMentions } from "@/lib/baxter-data/slack/intent";
import { detectSlackSearchRole } from "@/lib/baxter-data/slack/when";
import {
  isProjectInformationQuestion,
  isProjectStatusQuestion,
} from "@/lib/baxter-data/slack/project-status";

const Q1 = "how do I find more information about the katie liniger project?";
const Q2 = "give me information about the katie liniger project";
const Q3 = "what is the latest update in the #l01-24027-mcadams channel?";

const META_INCIDENT =
  "tell the team about how they can use you to create a new project now instead of relying solely on jackson.";

function entityLookupSemantic(name: string): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    entityName: name,
    entityTypeGuess: "unknown",
    lookupSpecificity: null,
    confidence: 0.8,
    source: "llm",
    latencyMs: 1,
    model: "test",
  };
}

function handleInput(
  question: string,
  semantic: SemanticQuestionClassification,
): EvidenceSourceHandleInput {
  const entity = resolveQuestionEntity({ question, semantic });
  return {
    question,
    history: [],
    entity,
    preferredSource: null,
    conversationMetadata: {},
    role: "user",
    channel: "web",
    ghlConfigured: true,
  };
}

describe("incident Q1 — how do I find info about named project", () => {
  it("is NOT baxter_meta_howto despite how-do-I shape", () => {
    expect(questionHasSpecificNamedEntity(Q1)).toBe(true);
    expect(isBaxterCapabilityMetaHowto(Q1)).toBe(false);
    expect(classifyCapabilityQuestion(Q1).reason).not.toBe("baxter_meta_howto");
    expect(answerCapabilityHelp({ question: Q1, role: "user" })).toBeNull();
    expect(
      answerCapabilityHelp({ question: Q1, role: "user", forceCapabilityHowto: true }),
    ).toBeNull();
  });

  it("routes to project-info Slack primary, not capability list", () => {
    expect(isProjectInformationQuestion(Q1)).toBe(true);
    expect(detectSlackSearchIntent(Q1)).toBe("project_status");
    expect(detectSlackSearchRole({ question: Q1 })).toBe("primary");
  });

  it("still keeps genuine meta howto for Baxter tool questions", () => {
    expect(isBaxterCapabilityMetaHowto(META_INCIDENT)).toBe(true);
    expect(classifyCapabilityQuestion(META_INCIDENT).reason).toBe("baxter_meta_howto");
    const help = answerCapabilityHelp({ question: META_INCIDENT, role: "user" });
    expect(help?.answer).toMatch(/\/new-project|New Project Setup/i);
  });
});

describe("incident Q2 — information about named project attempts real sources", () => {
  it("does not skip entity lookup; GHL and PEM canHandle claim with unknown type", () => {
    const semantic = entityLookupSemantic("katie liniger project");
    const entity = resolveQuestionEntity({ question: Q2, semantic });
    expect(entity.skipEntityLookup).toBe(false);
    expect(entity.extractedName?.toLowerCase()).toContain("liniger");

    const input = handleInput(Q2, semantic);
    expect(ghlEvidenceSource.canHandle(input).plausible).toBe(true);
    expect(pemEvidenceSource.canHandle(input).plausible).toBe(true);
  });

  it("Slack is primary for project-information questions", () => {
    expect(isProjectInformationQuestion(Q2)).toBe(true);
    expect(detectSlackSearchIntent(Q2)).toBe("project_status");
    expect(detectSlackSearchRole({ question: Q2 })).toBe("primary");
  });

  it("registry attempts GHL/PEM when semantic name is unknown-typed (not skip)", async () => {
    const semantic = entityLookupSemantic("katie liniger project");
    const tried: string[] = [];
    const registry = await runEvidenceRegistry({
      question: Q2,
      ghlConfigured: true,
      semantic,
      sources: [
        {
          key: "ghl",
          canHandle: (input) => ghlEvidenceSource.canHandle(input),
          resolve: async () => {
            tried.push("ghl");
            return {
              items: [],
              deterministicAnswer: "I couldn’t find katie liniger in GHL.",
              confidence: 0.1,
              softMiss: true,
            };
          },
        },
        {
          key: "pem_neat",
          canHandle: (input) => pemEvidenceSource.canHandle(input),
          resolve: async () => {
            tried.push("pem_neat");
            return {
              items: [],
              deterministicAnswer: "I couldn't find a completed PEM NEAT for Katie Liniger.",
              confidence: 0.1,
              softMiss: true,
            };
          },
        },
      ],
    });
    expect(tried).toContain("ghl");
    expect(tried).toContain("pem_neat");
    expect(registry.diagnostics.entity.skipEntityLookup).toBe(false);
    expect(registry.diagnostics.entity.extractedName?.toLowerCase()).toBe("katie liniger");
    expect(registry.earlyAnswer?.answer ?? "").not.toMatch(
      /New Project Setup|walk the team through/i,
    );
  });
});

describe("incident Q3 — #channel latest update must reach Slack Search", () => {
  it("never capability-howto / never meta howto", () => {
    expect(extractChannelMentions(Q3)).toEqual(["l01-24027-mcadams"]);
    expect(isBaxterCapabilityMetaHowto(Q3)).toBe(false);
    expect(classifyCapabilityQuestion(Q3).kind).toBe("none");
    expect(answerCapabilityHelp({ question: Q3, role: "user" })).toBeNull();
    expect(
      answerCapabilityHelp({ question: Q3, role: "user", forceCapabilityHowto: true }),
    ).toBeNull();
  });

  it("Slack intent is project_status / primary — unchanged pre-Prompt-3 behavior", () => {
    expect(isProjectStatusQuestion(Q3)).toBe(true);
    expect(detectSlackSearchIntent(Q3)).toBe("project_status");
    expect(detectSlackSearchRole({ question: Q3 })).toBe("primary");
  });

  it("general_conversational semantic must NOT set skipEntityLookup (Slack must remain reachable)", () => {
    const semantic: SemanticQuestionClassification = {
      questionType: "general_conversational",
      entityName: null,
      entityTypeGuess: null,
      lookupSpecificity: null,
      confidence: 0.9,
      source: "llm",
      latencyMs: 1,
      model: "test",
    };
    const entity = resolveQuestionEntity({ question: Q3, semantic });
    expect(entity.skipEntityLookup).toBe(false);
  });
});

describe("expanded realistic data-lookup phrasings (not capability-howto)", () => {
  const cases = [
    "how do I find more information about the katie liniger project?",
    "how can I get details on the Harrington barn conversion project?",
    "what is the latest update in the #l01-24027-mcadams channel?",
    "what's the latest status on #sales-ops?",
    "give me information about the maple street ADU project",
    "how do I look up information about Robert Vertin's opportunity?",
  ];

  it.each(cases)("does not answer with capability boilerplate: %s", (q) => {
    expect(isBaxterCapabilityMetaHowto(q)).toBe(false);
    const help = answerCapabilityHelp({ question: q, role: "user", forceCapabilityHowto: true });
    expect(help).toBeNull();
    expect(
      detectSlackSearchRole({ question: q }) !== "skip" || questionHasSpecificNamedEntity(q),
    ).toBe(true);
  });
});
