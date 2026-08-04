/**
 * Capability how-to routing — GHL plausibility filter + meta “use you to…” answers.
 */
import { describe, expect, it } from "vitest";
import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import {
  isPlausibleCrmEntityCandidate,
  resolveQuestionEntity,
  runEvidenceRegistry,
} from "@/lib/baxter-ai/evidence-registry";
import { ghlEvidenceSource } from "@/lib/baxter-ai/evidence-registry/sources/ghl";
import { classifyCapabilityQuestion } from "@/lib/baxter/capability-intent";
import { answerCapabilityHelp } from "@/lib/baxter/capability-help";
import { isBroadDossierQuestion } from "@/lib/dossier/format";
import type { EvidenceSourceHandleInput } from "@/lib/baxter-ai/evidence-registry/types";

const INCIDENT =
  "tell the team about how they can use you to create a new project now instead of relying solely on jackson.";

function ghlHandleInput(question: string): EvidenceSourceHandleInput {
  const entity = resolveQuestionEntity({ question });
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

describe("incident reproduction — opportunity pattern false positive", () => {
  it("does not treat capability how-to '… new project' as a CRM entity lookup", () => {
    const intent = detectGhlIntent(INCIDENT);
    // Tightened name capture + plausibility gate: never claim opportunity_lookup here.
    expect(intent.intent).not.toBe("opportunity_lookup");
    expect(intent.entities.opportunityName ?? intent.entities.contactName ?? null).toBeNull();
  });

  it("GHL canHandle no longer claims the incident question", () => {
    const handle = ghlEvidenceSource.canHandle(ghlHandleInput(INCIDENT));
    expect(handle.plausible).toBe(false);
    expect(handle.confidence).toBe(0);
  });

  it("returns a New Project Setup how-to, not a GHL not-found", async () => {
    const classified = classifyCapabilityQuestion(INCIDENT);
    expect(classified.kind).toBe("specific_capability");
    expect(classified.reason).toBe("baxter_meta_howto");
    expect(classified.topic).toBe("project_setup");

    const help = answerCapabilityHelp({ question: INCIDENT, role: "user" });
    expect(help).not.toBeNull();
    expect(help!.answer).toMatch(/\/new-project/);
    expect(help!.answer).toMatch(/New Project Setup/);
    expect(help!.answer).toMatch(/confirm/i);
    expect(help!.answer).not.toMatch(/couldn['’]t find/i);
    expect(help!.links.some((l) => l.href === "/projects/setup")).toBe(true);

    const registry = await runEvidenceRegistry({
      question: INCIDENT,
      ghlConfigured: true,
      role: "user",
      channel: "web",
      semanticOptions: { skipSemantic: true },
    });
    expect(registry.earlyAnswer?.answer ?? "").not.toMatch(/couldn['’]t find .+ in GHL/i);
  });
});

describe("GHL entity lookups still work (regression)", () => {
  it("still claims real opportunity/project name lookups", () => {
    const q = "What's the status of the Liniger project?";
    const intent = detectGhlIntent(q);
    expect(intent.intent).toBe("opportunity_lookup");
    expect(intent.entities.opportunityName).toMatch(/Liniger/i);
    expect(isPlausibleCrmEntityCandidate(intent.entities.opportunityName)).toBe(true);
    expect(ghlEvidenceSource.canHandle(ghlHandleInput(q)).plausible).toBe(true);
  });

  it("still claims Robert Vertin opportunity phrasing", () => {
    const q = "What's the status of the Robert Vertin opportunity?";
    expect(detectGhlIntent(q).intent).toBe("opportunity_lookup");
    expect(ghlEvidenceSource.canHandle(ghlHandleInput(q)).plausible).toBe(true);
  });
});

describe("other capability how-to phrasings", () => {
  it("routes PEM NEAT how-to away from GHL", () => {
    const q = "how can the team use you to generate a PEM NEAT?";
    expect(ghlEvidenceSource.canHandle(ghlHandleInput(q)).plausible).toBe(false);
    const help = answerCapabilityHelp({ question: q, role: "user" });
    expect(help?.answer).toMatch(/PEM NEAT/i);
    expect(help?.answer).not.toMatch(/couldn['’]t find/i);
  });

  it("routes Property Research how-to away from GHL", () => {
    const q = "walk me through how to use Baxter for property research";
    expect(classifyCapabilityQuestion(q).reason).toBe("baxter_meta_howto");
    const help = answerCapabilityHelp({ question: q, role: "user" });
    expect(help?.answer).toMatch(/Property Research/i);
    expect(help?.links.some((l) => l.href.includes("report"))).toBe(true);
  });

  it("routes Customer Center how-to away from GHL", () => {
    const q = "tell the team how they can use you to look someone up in Customer Center";
    expect(ghlEvidenceSource.canHandle(ghlHandleInput(q)).plausible).toBe(false);
    const help = answerCapabilityHelp({ question: q, role: "user" });
    expect(help?.answer).toMatch(/Customer Center/);
    expect(help?.links.some((l) => l.href === "/customers/lookup")).toBe(true);
  });
});

describe("Customer Center broad-question regression", () => {
  it("does not steal tell-me-everything dossier questions as capability how-tos", () => {
    const q = "Tell me everything about Jane Smith";
    expect(isBroadDossierQuestion(q)).toBe(true);
    expect(classifyCapabilityQuestion(q).reason).not.toBe("baxter_meta_howto");
    // No "use you" / meta-howto — capability help should not short-circuit with project setup
    const help = answerCapabilityHelp({ question: q, role: "user" });
    expect(help?.answer ?? "").not.toMatch(/\/new-project/);
  });

  it("capability meta-howto does not match dossier phrasing", () => {
    expect(isBroadDossierQuestion(INCIDENT)).toBe(false);
  });
});
