import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import {
  bootstrapBaxterOverviewEntry,
  getBaxterDiagnosticsSnapshot,
  runCompletePipelineDiagnosticTest,
  runKnowledgeSearchDiagnosticTest,
  runNormalDynamicAnswerDiagnostic,
  runOpenAiDiagnosticTest,
  runRateLimitClassificationDiagnostic,
} from "@/lib/baxter-ai/diagnostics";
import { AnthropicBaxterProvider } from "@/lib/baxter-ai/anthropic-provider";
import { embedText } from "@/lib/knowledge-index/embeddings";
import { getBaxterVisionProvider } from "@/lib/baxter-ai/vision";
import { retrieveBaxterEvidence } from "@/lib/baxter-ai/context";

export async function GET() {
  try {
    await requireAdmin();
    const snapshot = await getBaxterDiagnosticsSnapshot();
    return jsonOk(snapshot);
  } catch (error) {
    return jsonError(error, "GET /api/admin/baxter/diagnostics");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    const parsed = z
      .object({
        action: z.enum([
          "test_openai",
          "test_primary_reasoning",
          "test_fallback_reasoning",
          "test_embeddings",
          "test_vision",
          "test_knowledge",
          "test_pipeline",
          "test_dynamic_answer",
          "test_rate_limit_classification",
          "bootstrap_overview",
          "inspect_retrieval",
        ]),
        question: z.string().optional(),
      })
      .parse(body);

    if (parsed.action === "inspect_retrieval") {
      const question = parsed.question?.trim() || "Who is Baxter?";
      const evidence = await retrieveBaxterEvidence(question);
      const hit = evidence.structured?.lookups[0];
      const entitiesReset = Boolean(
        evidence.contextDecision &&
        !evidence.contextDecision.inheritPriorEntities &&
        evidence.contextDecision.reason !== "no_history",
      );
      return jsonOk({
        result: {
          question,
          intent: evidence.intent,
          queryMode: evidence.queryMode,
          contextDecision: evidence.contextDecision,
          inheritEntities: evidence.inheritEntities,
          entitiesReset,
          timeRange: evidence.plan.timeRange ?? null,
          retrievalQuery: evidence.retrievalQuery,
          plan: {
            entities: evidence.plan.entities,
            requestedFields: evidence.plan.requestedFields,
            aggregation: evidence.plan.aggregation,
            timeRange: evidence.plan.timeRange ?? null,
          },
          structured: {
            matchedSource:
              hit?.entryTitle ?? evidence.structured?.aggregates[0]?.entryTitle ?? null,
            matchedSheet: hit?.sheetName ?? null,
            matchedEntity: hit?.entityLabel ?? null,
            requestedField: hit?.requestedField ?? null,
            value: hit?.directValue ?? evidence.structured?.aggregates[0]?.displayValue ?? null,
            confidence: hit ? "high" : evidence.structured?.aggregates.length ? "high" : "none",
            lookupCount: evidence.structured?.lookups.length ?? 0,
            aggregateCount: evidence.structured?.aggregates.length ?? 0,
            ambiguous: evidence.structured?.ambiguous ?? false,
          },
          lexical: evidence.lexicalHits.slice(0, 5).map((h) => ({
            title: h.unit.title,
            unitType: h.unit.unit_type,
            score: h.score,
            reason: h.reason,
          })),
          semantic: evidence.semanticHits.slice(0, 5).map((h) => ({
            title: h.unit.title,
            unitType: h.unit.unit_type,
            score: Number(h.score.toFixed(4)),
            reason: h.reason,
          })),
          finalEvidence: evidence.ranked.slice(0, 8).map((r) => ({
            source: r.title,
            unitType: r.unitType ?? null,
            score: Number(r.score.toFixed(3)),
            reason: r.reason,
            channel: r.channel,
          })),
          conflicts: evidence.conflicts,
          evidencePackage: evidence.evidencePackage,
        },
      });
    }

    if (parsed.action === "test_openai" || parsed.action === "test_primary_reasoning") {
      return jsonOk({ result: await runOpenAiDiagnosticTest() });
    }
    if (parsed.action === "test_fallback_reasoning") {
      const started = Date.now();
      try {
        const provider = new AnthropicBaxterProvider();
        const result = await provider.generateAnswer({
          question: "Reply with the word OK as the answer field value.",
          contextItems: [],
          channel: "web",
          questionClass: "general_knowledge",
          identityContext: "Fallback diagnostic test.",
          history: [],
        });
        return jsonOk({
          result: {
            pass: /\bok\b/i.test(result.answer),
            answerPreview: result.answer.slice(0, 200),
            model: result.modelName,
            provider: result.modelProvider,
            latencyMs: result.latencyMs ?? Date.now() - started,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            answerPreview: error instanceof Error ? error.message : "Fallback test failed",
            model: null,
            provider: "anthropic",
            latencyMs: Date.now() - started,
          },
        });
      }
    }
    if (parsed.action === "test_embeddings") {
      const started = Date.now();
      try {
        const emb = await embedText("Baxter embedding diagnostic");
        return jsonOk({
          result: {
            pass: emb.vector.length > 0,
            provider: emb.provider,
            model: emb.model,
            dimensions: emb.vector.length,
            latencyMs: Date.now() - started,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            error: error instanceof Error ? error.message : "Embedding test failed",
            latencyMs: Date.now() - started,
          },
        });
      }
    }
    if (parsed.action === "test_vision") {
      const started = Date.now();
      try {
        const vision = getBaxterVisionProvider();
        const payload = Buffer.from(
          JSON.stringify({
            description: "Diagnostic diagram",
            extractedText: "OK",
            importantFacts: [],
            entities: [],
            documentType: "diagram",
            warnings: [],
          }),
          "utf8",
        ).toString("base64");
        const analysis = await vision.analyzeImage({
          mimeType: "image/png",
          base64Data: payload,
          filename: "diagnostic.png",
        });
        return jsonOk({
          result: {
            pass: Boolean(analysis.description || analysis.extractedText),
            provider: vision.key,
            model: vision.model,
            descriptionPreview: analysis.description.slice(0, 160),
            latencyMs: Date.now() - started,
          },
        });
      } catch (error) {
        return jsonOk({
          result: {
            pass: false,
            error: error instanceof Error ? error.message : "Vision test failed",
            latencyMs: Date.now() - started,
          },
        });
      }
    }
    if (parsed.action === "test_knowledge") {
      return jsonOk({ result: await runKnowledgeSearchDiagnosticTest() });
    }
    if (parsed.action === "test_pipeline") {
      return jsonOk({ result: await runCompletePipelineDiagnosticTest(user.id) });
    }
    if (parsed.action === "test_dynamic_answer") {
      return jsonOk({ result: await runNormalDynamicAnswerDiagnostic(user.id) });
    }
    if (parsed.action === "test_rate_limit_classification") {
      return jsonOk({ result: await runRateLimitClassificationDiagnostic() });
    }
    return jsonOk({ result: await bootstrapBaxterOverviewEntry(user.id) });
  } catch (error) {
    return jsonError(error, "POST /api/admin/baxter/diagnostics");
  }
}
