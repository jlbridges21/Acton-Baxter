import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api";
import {
  listEvalCases,
  runEnabledEvalSuite,
  runEvalCase,
  runEvalCategory,
  runGoldenEvalSuite,
  runSlackRecallEvalSuite,
  categoryAccuracyLabels,
  type EvalCategory,
} from "@/lib/baxter-ai/evaluations";

export async function GET() {
  try {
    await requireAdmin();
    const cases = await listEvalCases();
    return NextResponse.json({
      cases: cases.map((c) => ({
        id: c.id,
        question: c.question,
        category: c.category,
        enabled: c.enabled,
        expectedAnswer: c.expected_answer,
      })),
    });
  } catch (error) {
    return jsonError(error, "GET /api/admin/baxter/evaluations");
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = (await request.json()) as {
      action?: string;
      caseId?: string;
      category?: string;
    };
    if (body.action === "run_suite") {
      const summary = await runEnabledEvalSuite({ useFullAnswer: false });
      return NextResponse.json({
        ...summary,
        accuracy: categoryAccuracyLabels(summary.byCategory),
      });
    }
    if (body.action === "run_golden") {
      const summary = await runGoldenEvalSuite({ useFullAnswer: false });
      return NextResponse.json({
        ...summary,
        accuracy: categoryAccuracyLabels(summary.byCategory),
      });
    }
    if (body.action === "run_slack_recall") {
      const summary = await runSlackRecallEvalSuite();
      return NextResponse.json(summary);
    }
    if (body.action === "run_category" && body.category) {
      const summary = await runEvalCategory(body.category as EvalCategory, {
        useFullAnswer: false,
      });
      return NextResponse.json({
        ...summary,
        accuracy: categoryAccuracyLabels(summary.byCategory),
      });
    }
    if (body.action === "run_one" && body.caseId) {
      const cases = await listEvalCases();
      const evalCase = cases.find((c) => c.id === body.caseId);
      if (!evalCase) {
        return NextResponse.json({ error: "Case not found" }, { status: 404 });
      }
      const result = await runEvalCase(evalCase, { useFullAnswer: false });
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return jsonError(error, "POST /api/admin/baxter/evaluations");
  }
}
