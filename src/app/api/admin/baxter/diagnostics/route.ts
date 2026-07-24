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
          "test_knowledge",
          "test_pipeline",
          "test_dynamic_answer",
          "test_rate_limit_classification",
          "bootstrap_overview",
        ]),
      })
      .parse(body);

    if (parsed.action === "test_openai") {
      return jsonOk({ result: await runOpenAiDiagnosticTest() });
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
