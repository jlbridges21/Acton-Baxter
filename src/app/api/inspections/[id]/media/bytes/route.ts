/**
 * Mock/memory-only byte deposit for direct-upload tests when ENABLE_MOCK_RESEARCH.
 * Production uploads never hit this route — they go signed/TUS to Supabase Storage.
 */
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { RateLimitError, ValidationError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getEnv } from "@/lib/env";
import { putMemoryMediaBytes } from "@/lib/inspections/media-storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireActiveUser();
    await params;
    const env = getEnv();
    if (!(env.ENABLE_MOCK_RESEARCH && env.NODE_ENV !== "production")) {
      throw new ValidationError("Memory upload is only available in mock mode");
    }
    const rate = checkRateLimit(`inspection-media-bytes:${user.id}`, {
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) throw new RateLimitError();

    const form = await request.formData();
    const path = String(form.get("path") ?? "").trim();
    if (!path) throw new ValidationError("path is required");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("file is required");
    const buffer = Buffer.from(await file.arrayBuffer());
    putMemoryMediaBytes({
      storagePath: path,
      bytes: buffer,
      mimeType: file.type || "application/octet-stream",
      uploadedBy: user.id,
    });
    return jsonOk({ path, byteSize: buffer.byteLength });
  } catch (error) {
    return jsonError(error, "POST /api/inspections/[id]/media/bytes");
  }
}
