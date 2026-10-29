import { AppError, ValidationError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { importSource } from "@/lib/hr-lifecycle/commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Import or replace the leadership staff lifecycle checklist (.docx) with version metadata. */
export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    const rate = checkRateLimit(`lifecycle-source:${ctx.user.id}`, { limit: 10, windowMs: 60_000 });
    if (!rate.allowed)
      throw new AppError("Too many uploads. Please wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file))
      throw new ValidationError("Choose the checklist .docx file.");
    if (file.size > 10 * 1024 * 1024) throw new ValidationError("The file is larger than 10 MB.");
    const result = await importSource(
      ctx,
      { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
      String(form.get("versionLabel") ?? "").trim(),
      String(form.get("note") ?? ""),
    );
    return jsonOk({ result }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/ops/lifecycle/source");
  }
}
