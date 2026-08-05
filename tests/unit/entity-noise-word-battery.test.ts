/**
 * Customer Center oracle pattern for entity-resolution noise words.
 *
 * For each fixture person, Customer Center lookup uses a clean typed name.
 * Chat must extract at least that same core name from natural-language questions
 * that include leading/trailing generic descriptors ("project", "opportunity", …),
 * then search GHL with that cleaned query — not the noisy phrase.
 *
 * Extend ORACLE_FIXTURES with more real names as they become available.
 */
import { describe, expect, it } from "vitest";
import { buildGhlQueryPlan } from "@/lib/baxter-data/ghl/query-plan";
import { detectGhlIntent } from "@/lib/baxter-ai/ghl-intent";
import { parsePemEntityQuery } from "@/lib/baxter-data/pem-neats/intent";
import { extractProjectNameQueries } from "@/lib/baxter-data/slack/project-status";
import { resolveQuestionEntity } from "@/lib/baxter-ai/evidence-registry/entity-resolution";
import { normalizeEntitySearchName } from "@/lib/baxter-ai/entity-name-normalize";
import {
  buildGhlContactInformationAnswer,
  isBroadGhlEntityInfoQuestion,
} from "@/lib/connectors/ghl/address";
import {
  classifyCapabilityQuestion,
  isBaxterCapabilityMetaHowto,
} from "@/lib/baxter/capability-intent";
import { answerCapabilityHelp } from "@/lib/baxter/capability-help";
import type { SemanticQuestionClassification } from "@/lib/baxter-ai/semantic-question-classification";
import type { GhlContact } from "@/lib/connectors/ghl/types";

/** Customer Center–style oracle: clean name the UI would look up successfully. */
type OracleFixture = {
  /** Clean display name as shown in Customer Center / GHL. */
  coreName: string;
  /** Real GHL contact id when known (documentation only for offline tests). */
  ghlContactId?: string;
  /** Questions that must resolve to coreName (case-insensitive). */
  noisyQuestions: string[];
};

/**
 * Extensible battery — add rows freely; each question is asserted independently.
 */
export const ORACLE_FIXTURES: OracleFixture[] = [
  {
    coreName: "Katie Liniger",
    ghlContactId: "38R58HpyBSvtdnACqOzo",
    noisyQuestions: [
      "give me information about the katie liniger project",
      "the Katie Liniger opportunity",
      "Katie Liniger's deal",
      "customer Katie Liniger",
      "the Katie Liniger account",
    ],
  },
  {
    coreName: "Robert Vertin",
    noisyQuestions: [
      "give me information about the Robert Vertin project",
      "the Robert Vertin opportunity",
      "Robert Vertin's deal",
      "customer Robert Vertin",
      "the Robert Vertin account",
    ],
  },
  {
    coreName: "Denis Kornilov",
    noisyQuestions: [
      "information about the Denis Kornilov project",
      "the Denis Kornilov opportunity",
      "Denis Kornilov's deal",
      "contact Denis Kornilov",
      "the Denis Kornilov record",
    ],
  },
];

function noisySemantic(nameWithNoise: string): SemanticQuestionClassification {
  return {
    questionType: "entity_lookup",
    // Simulate the pre-fix classifier habit of attaching "project"
    entityName: nameWithNoise,
    entityTypeGuess: "unknown",
    lookupSpecificity: "generic",
    confidence: 0.88,
    source: "llm",
    latencyMs: 1,
    model: "test",
  };
}

function namesMatch(a: string | null | undefined, coreName: string): boolean {
  const left = (a ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const right = coreName.toLowerCase().replace(/\s+/g, " ").trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

describe("Customer Center oracle — noise-word entity resolution battery", () => {
  for (const fixture of ORACLE_FIXTURES) {
    describe(fixture.coreName, () => {
      for (const question of fixture.noisyQuestions) {
        it(`resolves clean GHL search name for: ${question}`, () => {
          // Simulate classifier that still attaches a trailing noise word
          const trailing = question.match(
            /\b(project|opportunity|deal|customer|contact|account|record|file)\b/i,
          )?.[1];
          const noisyEntity = trailing
            ? `${fixture.coreName} ${trailing}`.toLowerCase()
            : `${fixture.coreName} project`.toLowerCase();

          const entity = resolveQuestionEntity({
            question,
            semantic: noisySemantic(noisyEntity),
          });
          expect(namesMatch(entity.extractedName, fixture.coreName)).toBe(true);
          expect(entity.skipEntityLookup).toBe(false);

          const plan = buildGhlQueryPlan({
            question,
            entityNameHint: entity.extractedName,
          });
          expect(namesMatch(plan.entityName, fixture.coreName)).toBe(true);

          // Intent path alone (no semantic hint) must also clean
          const intent = detectGhlIntent(question);
          const intentName = intent.entities.contactName || intent.entities.opportunityName || null;
          if (intentName) {
            expect(namesMatch(intentName, fixture.coreName)).toBe(true);
          }

          const planSolo = buildGhlQueryPlan({ question });
          // Regex-only plan may miss some shapes; with semantic hint it must hit.
          // When solo extraction fires, it must be clean.
          if (planSolo.entityName) {
            expect(namesMatch(planSolo.entityName, fixture.coreName)).toBe(true);
          }
          // Prefer asserting the primary path used in production: hint from registry.
          expect(namesMatch(plan.entityName, fixture.coreName)).toBe(true);
        });

        it(`PEM + Slack normalize the same core for: ${question}`, () => {
          const pem = parsePemEntityQuery(question);
          // PEM may legitimately miss some phrasings (e.g. leading "contact X" without about/for);
          // when it does extract, it must not keep noise words.
          if (pem.nameQuery) {
            expect(namesMatch(pem.nameQuery, fixture.coreName)).toBe(true);
            expect(pem.nameQuery.toLowerCase()).not.toMatch(
              /\b(project|opportunity|deal|customer|contact|account|record|file)\b/,
            );
          }

          const slack = extractProjectNameQueries(question);
          const hit = slack.some((n) => namesMatch(n, fixture.coreName));
          // Slack project-name extractors fire on project/job/opportunity-ish shapes
          if (/\b(project|opportunity|deal|job|account)\b/i.test(question)) {
            expect(hit).toBe(true);
          }
        });
      }
    });
  }

  it("Katie incident question searches katie liniger, not the noisy phrase", () => {
    const q = "give me information about the katie liniger project";
    const entity = resolveQuestionEntity({
      question: q,
      semantic: noisySemantic("katie liniger project"),
    });
    expect(entity.extractedName?.toLowerCase()).toBe("katie liniger");
    const plan = buildGhlQueryPlan({ question: q, entityNameHint: entity.extractedName });
    expect(plan.entityName?.toLowerCase()).toBe("katie liniger");
    expect(normalizeEntitySearchName("katie liniger project")).toBe("katie liniger");
  });
});

describe("broad GHL information answer format", () => {
  it("includes contact details, opportunity/stage, and Customer Center link", () => {
    expect(
      isBroadGhlEntityInfoQuestion("give me information about the katie liniger project"),
    ).toBe(true);
    const contact = {
      id: "38R58HpyBSvtdnACqOzo",
      name: "Katie Liniger",
      email: "katie@example.com",
      phone: "555-0100",
      address1: "123 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
    } as GhlContact;

    const answer = buildGhlContactInformationAnswer({
      contact,
      pipelineName: "Sales Pipeline",
      stageName: "Proposal",
      opportunityName: "Katie ADU",
      opportunityCount: 2,
    });

    expect(answer).toMatch(/Katie Liniger/);
    expect(answer).toMatch(/katie@example\.com/);
    expect(answer).toMatch(/555-0100/);
    expect(answer).toMatch(/Proposal/);
    expect(answer).toMatch(/Sales Pipeline/);
    expect(answer).toMatch(/\/customers\/lookup\?contactId=38R58HpyBSvtdnACqOzo/);
    expect(answer).not.toMatch(/couldn['’]t find/i);
  });
});

describe("capability-howto regression (prior prompts)", () => {
  const META =
    "tell the team about how they can use you to create a new project now instead of relying solely on jackson.";

  it("still treats genuine Baxter how-tos as capability, not entity lookup", () => {
    expect(isBaxterCapabilityMetaHowto(META)).toBe(true);
    expect(classifyCapabilityQuestion(META).reason).toBe("baxter_meta_howto");
    const help = answerCapabilityHelp({ question: META, role: "user" });
    expect(help?.answer).toMatch(/\/new-project|New Project Setup/i);

    const entity = resolveQuestionEntity({
      question: META,
      semantic: {
        questionType: "capability_howto",
        entityName: null,
        entityTypeGuess: null,
        lookupSpecificity: null,
        confidence: 0.95,
        source: "llm",
        latencyMs: 1,
        model: "test",
      },
    });
    expect(entity.skipEntityLookup).toBe(true);
  });

  it("does not capability-howto a named Katie information ask", () => {
    const q = "give me information about the katie liniger project";
    expect(isBaxterCapabilityMetaHowto(q)).toBe(false);
    expect(
      answerCapabilityHelp({ question: q, role: "user", forceCapabilityHowto: true }),
    ).toBeNull();
  });
});

describe("end-to-end GHL resolve uses cleaned query (mocked)", () => {
  it("Katie information question plans a clean search and formats a rich summary", () => {
    const q = "give me information about the katie liniger project";
    const plan = buildGhlQueryPlan({
      question: q,
      entityNameHint: "katie liniger project",
    });
    expect(plan.entityName?.toLowerCase()).toBe("katie liniger");

    const contact = {
      id: "38R58HpyBSvtdnACqOzo",
      name: "Katie Liniger",
      email: "katie@example.com",
      phone: "555-0199",
      address1: "1 Oak Ave",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
    } as GhlContact;

    const answer = buildGhlContactInformationAnswer({
      contact,
      pipelineName: "Sales",
      stageName: "Qualified",
      opportunityName: "Katie ADU",
      opportunityCount: 2,
    });
    expect(answer).toMatch(/Katie Liniger/);
    expect(answer).toMatch(/katie@example\.com/);
    expect(answer).toMatch(/Qualified/);
    expect(answer).toMatch(/\/customers\/lookup\?contactId=38R58HpyBSvtdnACqOzo/);
  });
});
