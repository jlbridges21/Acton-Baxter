import { AppError, ValidationError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/api";
import { requireAiContext } from "@/lib/agents/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { opsAccessFor } from "@/lib/ops/commands";
import { uploadOpsDocument } from "@/lib/ops/documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuid = (v: FormDataEntryValue | null) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

/** Upload an HR/contract document to private storage (employees: their own documents only). */
export async function POST(request: Request) {
  try {
    const ctx = await requireAiContext();
    const rate = checkRateLimit(`ops-upload:${ctx.user.id}`, { limit: 30, windowMs: 60_000 });
    if (!rate.allowed)
      throw new AppError("Too many uploads. Please wait a moment.", {
        code: "RATE_LIMITED",
        statusCode: 429,
        expose: true,
      });
    const access = await opsAccessFor(ctx);
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file))
      throw new ValidationError("Choose a file.");
    const row = await uploadOpsDocument({
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      category: String(form.get("category") ?? ""),
      title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
      entityId: uuid(form.get("entityId")),
      personId: uuid(form.get("personId")),
      contractId: uuid(form.get("contractId")),
      instanceId: uuid(form.get("instanceId")),
      stepId: uuid(form.get("stepId")),
      signed: form.get("signed") === "true",
      access,
      actorLabel: ctx.user.profile.full_name || ctx.user.email,
    });
    return jsonOk({ document: { ...row, extracted_text: null } }, { status: 201 });
  } catch (error) {
    return jsonError(error, "POST /api/ops/documents");
  }
}
